/**
 * The service map — who calls whom, from the traces themselves.
 *
 * A dependency nobody wrote down is the one that breaks the incident: the
 * service you had forgotten talks to the database you are about to restart.
 * These edges are read out of what actually happened, so the map is right by
 * construction rather than right until somebody forgets to update it.
 *
 * The rollup is a minute at a time, and a few minutes behind. Both are on
 * purpose. A minute is the finest grain the screens ask for, and being late is
 * what makes the join possible at all: the caller's span and the callee's span
 * come from two services and land at two different moments, so a rollup that
 * ran the instant a minute closed would miss half its own edges.
 */
import { clickhouse } from "./client";
import { read, SPANS } from "./query";

export const EDGES = "service_edges_t(tenant = {tenant:UUID})";
export const EDGE_RUNS = "service_edge_runs_t(tenant = {tenant:UUID})";

/**
 * How far behind the clock the rollup stays.
 *
 * Three minutes, because that is the span of arrival we have measured between
 * a caller and its callee under a batching exporter with the default schedule
 * (five seconds) plus the usual queueing. Less loses edges silently, which is
 * the one failure this screen must not have: a missing edge reads as "these
 * two services do not talk", and somebody will believe it.
 */
export const ROLLUP_LAG_MINUTES = 3;

/** How far back a cold start will go rather than leaving the map empty. */
export const ROLLUP_BACKFILL_MINUTES = 120;

export type EdgeRow = {
  source_service: string;
  target_service: string;
  environment: string;
  n_calls: string;
  n_errors: string;
  p50_ms: number;
  p95_ms: number;
};

/**
 * Rolls one minute of spans into edges.
 *
 * The join is a child span against its parent, and it is written as an inner
 * join on `span_id` rather than as a correlated subquery so ClickHouse reads
 * each side once. Both sides are bounded by the same widened window: a span
 * and its parent can straddle a minute boundary, and an edge lost to arithmetic
 * is as invisible as an edge lost to a missing exporter.
 *
 * The rule is "a child span in another service", and deliberately not "a
 * `client` span whose child is a `server` span". The second is the semantic
 * convention and it is what a fully instrumented HTTP call looks like — but it
 * is not what everything looks like. A database span is commonly attributed to
 * the database rather than to its caller, a messaging consumer sometimes
 * arrives as `internal`, and a library that sets no kind at all sets
 * `unspecified`. Every one of those is a real dependency, and filtering on
 * kind drops them without a word: the map then says two services do not talk,
 * and somebody restarts one of them during an incident.
 */
export async function rollupServiceEdges(
  tenantId: string,
  minute: Date,
  retentionAt: string,
): Promise<number> {
  const start = new Date(Math.floor(minute.getTime() / 60_000) * 60_000);
  const end = new Date(start.getTime() + 60_000);
  // The parent may have started slightly before its child's minute and ended
  // slightly after; a minute either side covers every call we have seen.
  const from = new Date(start.getTime() - 60_000);
  const to = new Date(end.getTime() + 60_000);

  /*
   * The raw table, on purpose, and the one place that does.
   *
   * `read()` refuses a query naming a raw table, because a forgotten tenant
   * filter there is a leak. An INSERT … SELECT cannot go through the tenant
   * views — they are read-only table functions — so the filter is written by
   * hand instead, on **both** sides of the join. A parent belonging to another
   * workspace could otherwise be joined to this one's child, and the edge
   * would name a service the reader has never heard of.
   */
  const ch = clickhouse();
  await ch.command({
    query: `
      INSERT INTO service_edges_1m
      SELECT
          {tenant:UUID} AS tenant_id,
          {minute:DateTime} AS minute,
          child.environment AS environment,
          parent.service_name AS source_service,
          child.service_name AS target_service,
          countState() AS calls,
          countIfState(child.status_code = 'error') AS errors,
          quantilesState(0.5, 0.95)(child.duration_ns) AS duration,
          {retention:DateTime} AS retention_at
        FROM (
          SELECT service_name, environment, parent_span_id, status_code, duration_ns
            FROM otel_spans
           WHERE tenant_id = {tenant:UUID}
             AND start_ts >= {start:DateTime64(9)} AND start_ts < {end:DateTime64(9)}
             AND parent_span_id != ''
        ) AS child
        INNER JOIN (
          SELECT span_id, service_name
            FROM otel_spans
           WHERE tenant_id = {tenant:UUID}
             AND start_ts >= {from:DateTime64(9)} AND start_ts < {to:DateTime64(9)}
        ) AS parent
        ON child.parent_span_id = parent.span_id
       WHERE parent.service_name != child.service_name
       GROUP BY environment, source_service, target_service`,
    query_params: {
      tenant: tenantId,
      minute: chTime(start).slice(0, 19),
      start: chTime(start),
      end: chTime(end),
      from: chTime(from),
      to: chTime(to),
      retention: retentionAt,
    },
  });

  const rs = await ch.query({
    query: `SELECT count() AS n
              FROM service_edges_1m
             WHERE tenant_id = {tenant:UUID} AND minute = {minute:DateTime}`,
    query_params: { tenant: tenantId, minute: chTime(start).slice(0, 19) },
    format: "JSONEachRow",
  });
  const [row] = await rs.json<{ n: string }>();
  const edges = Number(row?.n ?? 0);

  await ch.insert({
    table: "service_edge_runs",
    format: "JSONEachRow",
    values: [{ tenant_id: tenantId, minute: chTime(start).slice(0, 19), edges }],
  });
  return edges;
}

/** The minutes still to roll up, oldest first — a gap is filled, not skipped. */
export async function pendingMinutes(
  tenantId: string,
  now = new Date(),
  backfill = ROLLUP_BACKFILL_MINUTES,
): Promise<Date[]> {
  const newest = Math.floor((now.getTime() - ROLLUP_LAG_MINUTES * 60_000) / 60_000) * 60_000;
  const oldest = newest - (backfill - 1) * 60_000;
  const done = new Set(
    (
      await read<{ slot: string }>(
        tenantId,
        // `AS slot` and not `AS minute`: an output alias that repeats a source
        // column name shadows it, and the WHERE below would then be comparing
        // its own String output to a DateTime. The same trap has now cost this
        // codebase four queries.
        `SELECT toString(minute) AS slot
           FROM ${EDGE_RUNS}
          WHERE minute >= {oldest:DateTime}
          ORDER BY minute`,
        { params: { oldest: chTime(new Date(oldest)).slice(0, 19) }, maxRows: 10_000 },
      )
    ).map((r) => r.slot),
  );
  const out: Date[] = [];
  for (let t = oldest; t <= newest; t += 60_000) {
    if (!done.has(chTime(new Date(t)).slice(0, 19))) out.push(new Date(t));
  }
  return out;
}

/** The map as the screen reads it: one row per pair of services over a window. */
export async function serviceEdges(
  tenantId: string,
  opts: { sinceMinutes?: number; environment?: string } = {},
): Promise<EdgeRow[]> {
  const since = opts.sinceMinutes ?? 60;
  const where = ["e.minute >= now() - INTERVAL {since:UInt32} MINUTE"];
  if (opts.environment) where.push("e.environment = {environment:String}");
  return read<EdgeRow>(
    tenantId,
    // Every output alias differs from the column it reads, and the table is
    // aliased: `AS calls` over `countMerge(calls)` shadows the source column,
    // and the merge then receives its own String output.
    `SELECT e.source_service AS source_service,
            e.target_service AS target_service,
            any(e.environment) AS environment,
            toString(countMerge(e.calls)) AS n_calls,
            toString(countIfMerge(e.errors)) AS n_errors,
            quantilesMerge(0.5, 0.95)(e.duration)[1] / 1000000 AS p50_ms,
            quantilesMerge(0.5, 0.95)(e.duration)[2] / 1000000 AS p95_ms
       FROM ${EDGES} AS e
      WHERE ${where.join(" AND ")}
      GROUP BY source_service, target_service
      ORDER BY countMerge(e.calls) DESC
      LIMIT 500`,
    {
      params: { since, ...(opts.environment ? { environment: opts.environment } : {}) },
    },
  );
}

/** The services that appear in the traces at all, edges or not. */
export async function servicesSeen(
  tenantId: string,
  sinceMinutes = 60,
): Promise<Array<{ service_name: string; spans: string; n_errors: string }>> {
  return read(
    tenantId,
    `SELECT s.service_name AS service_name,
            toString(count()) AS spans,
            toString(countIf(s.status_code = 'error')) AS n_errors
       FROM ${SPANS} AS s
      WHERE s.start_ts >= now() - INTERVAL {since:UInt32} MINUTE
      GROUP BY service_name
      ORDER BY count() DESC
      LIMIT 200`,
    { params: { since: sinceMinutes } },
  );
}

function chTime(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "");
}

/**
 * Services in columns, by how far in they are.
 *
 * Depth is the longest path that reaches a service, not the shortest: a
 * database called both directly by the front door and through two other
 * services belongs on the right, where the reader looks for what everything
 * ends up depending on. A cycle — which real architectures do have — stops the
 * walk rather than looping, and its members settle at the depth of whichever
 * edge reached them first.
 */
export function layoutByDepth(
  edges: Array<{ source_service: string; target_service: string }>,
  services: string[],
): string[][] {
  const depth = new Map<string, number>(services.map((s) => [s, 0]));
  const out = new Map<string, string[]>();
  for (const e of edges) {
    out.set(e.source_service, [...(out.get(e.source_service) ?? []), e.target_service]);
    if (!depth.has(e.target_service)) depth.set(e.target_service, 0);
    if (!depth.has(e.source_service)) depth.set(e.source_service, 0);
  }

  // Longest path, bounded by the number of services: past that many rounds a
  // cycle is the only thing still pushing depths up, and it would not stop.
  for (let round = 0; round < depth.size; round++) {
    let moved = false;
    for (const e of edges) {
      const next = (depth.get(e.source_service) ?? 0) + 1;
      if (next > (depth.get(e.target_service) ?? 0)) {
        depth.set(e.target_service, next);
        moved = true;
      }
    }
    if (!moved) break;
  }

  const deepest = Math.max(0, ...depth.values());
  const columns: string[][] = Array.from({ length: deepest + 1 }, () => []);
  for (const [service, d] of [...depth].sort(([a], [b]) => a.localeCompare(b))) {
    columns[Math.min(d, deepest)]!.push(service);
  }
  return columns.filter((c) => c.length > 0);
}
