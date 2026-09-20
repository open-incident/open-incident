/**
 * What the telemetry has to say about one incident, within a budget.
 *
 * An investigation reads this, and an investigation is a model with a context
 * window: the answer has to be aggregates and a handful of named examples,
 * never a dump. Ten thousand log lines would not make the analysis better, it
 * would push the timeline and the change events out of the prompt and make it
 * worse.
 *
 * Every figure is given **against the same window the day before**, because a
 * number on its own says nothing. "Four hundred errors" is either a catastrophe
 * or a Tuesday, and only the comparison tells you which.
 */
import { read, EXCEPTION_GROUPS, LOGS, SPANS } from "./query";
import { EDGES } from "./service-map";

const DAY_MS = 86_400_000;

export type ServiceWindow = {
  errorLogs: number;
  errorLogsBefore: number;
  spans: number;
  spansBefore: number;
  errorSpans: number;
  errorSpansBefore: number;
  p95Ms: number;
  p95MsBefore: number;
};

/** The service's own numbers in the window, and in the same window yesterday. */
export async function serviceWindow(
  tenantId: string,
  service: string,
  from: Date,
  to: Date,
): Promise<ServiceWindow> {
  const params = {
    service,
    from: ch(from),
    to: ch(to),
    fromBefore: ch(new Date(from.getTime() - DAY_MS)),
    toBefore: ch(new Date(to.getTime() - DAY_MS)),
  };

  const [logs] = await read<{ now: string; before: string }>(
    tenantId,
    `SELECT toString(countIf(l.ts >= {from:DateTime64(9)} AND l.ts < {to:DateTime64(9)})) AS now,
            toString(countIf(l.ts >= {fromBefore:DateTime64(9)} AND l.ts < {toBefore:DateTime64(9)})) AS before
       FROM ${LOGS} AS l
      WHERE l.service_name = {service:String}
        AND l.severity_number >= 17
        AND l.ts >= {fromBefore:DateTime64(9)} AND l.ts < {to:DateTime64(9)}`,
    { params },
  );

  const [spans] = await read<{
    now: string;
    before: string;
    errs: string;
    errsBefore: string;
    p95: number;
    p95Before: number;
  }>(
    tenantId,
    `SELECT toString(countIf(inWindow)) AS now,
            toString(countIf(NOT inWindow)) AS before,
            toString(countIf(inWindow AND s.status_code = 'error')) AS errs,
            toString(countIf(NOT inWindow AND s.status_code = 'error')) AS errsBefore,
            quantileIf(0.95)(s.duration_ns, inWindow) / 1000000 AS p95,
            quantileIf(0.95)(s.duration_ns, NOT inWindow) / 1000000 AS p95Before
       FROM (
         SELECT status_code, duration_ns,
                (ts_at >= {from:DateTime64(9)} AND ts_at < {to:DateTime64(9)}) AS inWindow
           FROM (
             SELECT status_code, duration_ns, start_ts AS ts_at, service_name
               FROM ${SPANS}
           )
          WHERE service_name = {service:String}
            AND ((ts_at >= {from:DateTime64(9)} AND ts_at < {to:DateTime64(9)})
              OR (ts_at >= {fromBefore:DateTime64(9)} AND ts_at < {toBefore:DateTime64(9)}))
       ) AS s`,
    { params },
  );

  return {
    errorLogs: Number(logs?.now ?? 0),
    errorLogsBefore: Number(logs?.before ?? 0),
    spans: Number(spans?.now ?? 0),
    spansBefore: Number(spans?.before ?? 0),
    errorSpans: Number(spans?.errs ?? 0),
    errorSpansBefore: Number(spans?.errsBefore ?? 0),
    p95Ms: finite(spans?.p95),
    p95MsBefore: finite(spans?.p95Before),
  };
}

export type NewException = {
  fingerprint: string;
  type: string;
  message: string;
  occurrences: number;
  first_seen: string;
};

/**
 * Exception groups whose first occurrence falls inside the window.
 *
 * First-seen rather than last-seen: a bug that has been firing for a month is
 * background noise during an incident, and one that appeared twenty minutes
 * before the incident was declared is the thing to read first.
 */
export async function newExceptions(
  tenantId: string,
  from: Date,
  to: Date,
  service?: string,
): Promise<NewException[]> {
  const where = ["g.first_seen >= {from:DateTime}", "g.first_seen < {to:DateTime}"];
  if (service) where.push("has(g.services, {service:String})");
  return read<NewException>(
    tenantId,
    `SELECT g.fingerprint AS fingerprint,
            g.type AS type,
            g.message AS message,
            toUInt32(g.occurrences) AS occurrences,
            toString(g.first_seen) AS first_seen
       FROM ${EXCEPTION_GROUPS} AS g
      WHERE ${where.join(" AND ")}
      ORDER BY g.occurrences DESC
      LIMIT 8`,
    {
      params: {
        from: ch(from).slice(0, 19),
        to: ch(to).slice(0, 19),
        ...(service ? { service } : {}),
      },
    },
  );
}

export type Neighbour = {
  other: string;
  direction: "upstream" | "downstream";
  calls: number;
  errors: number;
  p95Ms: number;
  callsBefore: number;
  errorsBefore: number;
};

/**
 * Who this service talks to, and how that traffic compares to yesterday.
 *
 * Upstream and downstream are both returned, and the distinction is the whole
 * point: a downstream neighbour erroring is a likely cause, an upstream one
 * erroring is a likely consequence. An investigation that cannot tell them
 * apart will confidently name the victim.
 */
export async function neighbours(
  tenantId: string,
  service: string,
  from: Date,
  to: Date,
): Promise<Neighbour[]> {
  const rows = await read<{
    other: string;
    direction: string;
    n_calls: string;
    n_errors: string;
    p95: number;
    n_calls_before: string;
    n_errors_before: string;
  }>(
    tenantId,
    // Both windows in one pass: the edges are an AggregatingMergeTree, so the
    // states have to be merged, and merging twice over two scans costs twice
    // what merging once with a condition does.
    `SELECT other,
            direction,
            toString(countMergeIf(e.calls, e.inWindow)) AS n_calls,
            toString(countIfMergeIf(e.errors, e.inWindow)) AS n_errors,
            quantilesMergeIf(0.5, 0.95)(e.duration, e.inWindow)[2] / 1000000 AS p95,
            toString(countMergeIf(e.calls, NOT e.inWindow)) AS n_calls_before,
            toString(countIfMergeIf(e.errors, NOT e.inWindow)) AS n_errors_before
       FROM (
         SELECT target_service AS other, 'downstream' AS direction, calls, errors, duration,
                (minute >= {from:DateTime} AND minute < {to:DateTime}) AS inWindow
           FROM ${EDGES}
          WHERE source_service = {service:String}
            AND ((minute >= {from:DateTime} AND minute < {to:DateTime})
              OR (minute >= {fromBefore:DateTime} AND minute < {toBefore:DateTime}))
         UNION ALL
         SELECT source_service AS other, 'upstream' AS direction, calls, errors, duration,
                (minute >= {from:DateTime} AND minute < {to:DateTime}) AS inWindow
           FROM ${EDGES}
          WHERE target_service = {service:String}
            AND ((minute >= {from:DateTime} AND minute < {to:DateTime})
              OR (minute >= {fromBefore:DateTime} AND minute < {toBefore:DateTime}))
       ) AS e
      GROUP BY other, direction
      ORDER BY countMergeIf(e.calls, e.inWindow) DESC
      LIMIT 12`,
    {
      params: {
        service,
        from: ch(from).slice(0, 19),
        to: ch(to).slice(0, 19),
        fromBefore: ch(new Date(from.getTime() - DAY_MS)).slice(0, 19),
        toBefore: ch(new Date(to.getTime() - DAY_MS)).slice(0, 19),
      },
    },
  );
  return rows.map((r) => ({
    other: r.other,
    direction: r.direction === "upstream" ? "upstream" : "downstream",
    calls: Number(r.n_calls),
    errors: Number(r.n_errors),
    p95Ms: finite(r.p95),
    callsBefore: Number(r.n_calls_before),
    errorsBefore: Number(r.n_errors_before),
  }));
}

function finite(n: number | undefined): number {
  return Number.isFinite(n) ? Math.round(Number(n) * 10) / 10 : 0;
}

function ch(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "");
}

export type GroupRate = {
  fingerprint: string;
  type: string;
  message: string;
  firstSeen: string;
  lastSeen: string;
  /** Occurrences in the hour that just closed. */
  lastHour: number;
  /** The usual hour for this group: the median over the past week. */
  usualHour: number;
  hoursOfHistory: number;
};

/**
 * Every exception group's recent rate, against what is usual for it.
 *
 * The comparison is a **median of hourly counts over the past week**, not an
 * average and not the previous hour. A median because a group's history
 * contains its own past incidents, and one bad afternoon in an average is
 * enough to hide the next one. Over a week rather than a day because most
 * services are quiet at night, and an hour compared to the hour before it
 * calls every morning a surge.
 */
export async function groupRates(tenantId: string, at: Date = new Date()): Promise<GroupRate[]> {
  const hourEnd = new Date(Math.floor(at.getTime() / 3_600_000) * 3_600_000);
  const hourStart = new Date(hourEnd.getTime() - 3_600_000);
  const weekStart = new Date(hourStart.getTime() - 7 * DAY_MS);

  const rows = await read<{
    fingerprint: string;
    type: string;
    message: string;
    first_seen: string;
    last_seen: string;
    last_hour: string;
    usual_hour: number;
    hours: string;
  }>(
    tenantId,
    // The per-hour rows are merged once, then split by window with a condition:
    // two passes over an AggregatingMergeTree cost twice what one does.
    `SELECT fingerprint,
            any(g_type) AS type,
            any(g_message) AS message,
            toString(min(g_first)) AS first_seen,
            toString(max(g_last)) AS last_seen,
            toUInt32(sumIf(n, recent)) AS last_hour,
            quantileIf(0.5)(n, NOT recent) AS usual_hour,
            toString(countIf(NOT recent)) AS hours
       FROM (
         SELECT g.fingerprint AS fingerprint,
                any(g.type) AS g_type,
                any(g.message) AS g_message,
                min(g.first_seen) AS g_first,
                max(g.last_seen) AS g_last,
                g.hour AS hour,
                countMerge(g.count) AS n,
                (g.hour >= {hourStart:DateTime} AND g.hour < {hourEnd:DateTime}) AS recent
           FROM exception_groups_1h_t(tenant = {tenant:UUID}) AS g
          WHERE g.hour >= {weekStart:DateTime} AND g.hour < {hourEnd:DateTime}
          GROUP BY fingerprint, hour, recent
       )
      GROUP BY fingerprint
      ORDER BY last_hour DESC
      LIMIT 500`,
    {
      params: {
        hourStart: chHour(hourStart),
        hourEnd: chHour(hourEnd),
        weekStart: chHour(weekStart),
      },
      maxRows: 500,
    },
  );

  return rows.map((r) => ({
    fingerprint: r.fingerprint,
    type: r.type,
    message: r.message,
    firstSeen: r.first_seen,
    lastSeen: r.last_seen,
    lastHour: Number(r.last_hour),
    usualHour: Number.isFinite(r.usual_hour) ? Number(r.usual_hour) : 0,
    hoursOfHistory: Number(r.hours),
  }));
}

function chHour(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
}
