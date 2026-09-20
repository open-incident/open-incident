/**
 * Reading what browsers reported.
 *
 * Every figure here is a **p75**, and that is not a style choice. An average
 * page load is a number no visitor experienced: it is dragged down by the
 * cached repeat visits and hides the first-time visitor on a phone, who is the
 * one deciding whether to come back. The 75th percentile is what Google's own
 * thresholds are defined against, so a "good" here means the same thing as a
 * "good" in every other tool the reader has used.
 */
import { read } from "./query";

export { RUM_EVENTS, RUM_SESSIONS } from "./views";
import { RUM_EVENTS, RUM_REPLAY_CHUNKS, RUM_REPLAYS, RUM_SESSIONS } from "./views";

/** The five, in the order a page produces them. */
export const VITALS = ["TTFB", "FCP", "LCP", "CLS", "INP"] as const;

export type VitalRow = {
  vital_name: string;
  p75: number;
  good: string;
  needs: string;
  poor: string;
  samples: string;
};

export type RumWindow = { appId?: string; sinceHours?: number; route?: string };

function where(w: RumWindow, params: Record<string, unknown>): string {
  const clauses = ["e.ts >= now() - INTERVAL {since:UInt32} HOUR"];
  params.since = w.sinceHours ?? 24;
  if (w.appId) {
    clauses.push("e.app_id = {app:UUID}");
    params.app = w.appId;
  }
  if (w.route) {
    clauses.push("e.route = {route:String}");
    params.route = w.route;
  }
  return clauses.join(" AND ");
}

/** The five vitals at p75, with how the samples fell across the thresholds. */
export async function rumVitals(tenantId: string, w: RumWindow = {}): Promise<VitalRow[]> {
  const params: Record<string, unknown> = {};
  const clause = where(w, params);
  return read<VitalRow>(
    tenantId,
    `SELECT e.vital_name AS vital_name,
            quantile(0.75)(e.vital_value) AS p75,
            toString(countIf(e.vital_rating = 'good')) AS good,
            toString(countIf(e.vital_rating = 'needs-improvement')) AS needs,
            toString(countIf(e.vital_rating = 'poor')) AS poor,
            toString(count()) AS samples
       FROM ${RUM_EVENTS} AS e
      WHERE ${clause} AND e.event_type = 'web_vital' AND e.vital_name != ''
      GROUP BY vital_name`,
    { params },
  );
}

export type RouteRow = {
  route: string;
  views: string;
  lcp_p75: number;
  inp_p75: number;
  cls_p75: number;
  errors: string;
};

/**
 * One row per route, which is the unit anybody acts on.
 *
 * Not per URL: `/orders/4821` and `/orders/9134` are one page, and grouping by
 * URL gives a table with one row per visitor. The SDK replaces the identifiers
 * it can recognise and a page can name its own route, which is always better
 * than a guess.
 */
export async function rumRoutes(tenantId: string, w: RumWindow = {}): Promise<RouteRow[]> {
  const params: Record<string, unknown> = {};
  const clause = where(w, params);
  return read<RouteRow>(
    tenantId,
    `SELECT e.route AS route,
            toString(uniq(e.view_id)) AS views,
            quantileIf(0.75)(e.vital_value, e.vital_name = 'LCP') AS lcp_p75,
            quantileIf(0.75)(e.vital_value, e.vital_name = 'INP') AS inp_p75,
            quantileIf(0.75)(e.vital_value, e.vital_name = 'CLS') AS cls_p75,
            toString(countIf(e.event_type = 'error')) AS errors
       FROM ${RUM_EVENTS} AS e
      WHERE ${clause}
      GROUP BY route
      ORDER BY uniq(e.view_id) DESC
      LIMIT 50`,
    { params },
  );
}

export type SegmentRow = { segment: string; views: string; lcp_p75: number };

/**
 * The same question cut by country, device or browser.
 *
 * Which of the three is the argument rather than three functions, because the
 * query is identical and the point of the screen is to flip between them: "is
 * it slow" almost always turns out to be "is it slow on Android in Brazil",
 * and that answer is one click away or it is not found.
 */
export async function rumSegments(
  tenantId: string,
  by: "country" | "device" | "browser",
  w: RumWindow = {},
): Promise<SegmentRow[]> {
  const params: Record<string, unknown> = {};
  const clause = where(w, params);
  // The column is chosen from a fixed set, never interpolated from a caller.
  const column = by === "country" ? "e.country" : by === "device" ? "e.device" : "e.browser";
  return read<SegmentRow>(
    tenantId,
    `SELECT ${column} AS segment,
            toString(uniq(e.view_id)) AS views,
            quantileIf(0.75)(e.vital_value, e.vital_name = 'LCP') AS lcp_p75
       FROM ${RUM_EVENTS} AS e
      WHERE ${clause}
      GROUP BY segment
      ORDER BY uniq(e.view_id) DESC
      LIMIT 20`,
    { params },
  );
}

export type RumErrorRow = {
  error_type: string;
  message: string;
  occurrences: string;
  sessions: string;
  last_seen: string;
  route: string;
};

/**
 * JavaScript errors, grouped the way the exception screen groups its own.
 *
 * By type and message with the variable parts taken out — a browser produces
 * the same failure once per visitor, and ungrouped it is a list of the same
 * line ten thousand times.
 */
export async function rumErrors(tenantId: string, w: RumWindow = {}): Promise<RumErrorRow[]> {
  const params: Record<string, unknown> = {};
  const clause = where(w, params);
  return read<RumErrorRow>(
    tenantId,
    // Grouped on the message with its variable parts removed, the same idea
    // the exception screen uses: "user 4821 not found" and "user 9134 not
    // found" are one bug, and ungrouped they are two lines out of ten thousand.
    `SELECT e.error_type AS error_type,
            any(e.error_message) AS message,
            toString(count()) AS occurrences,
            toString(uniq(e.session_id)) AS sessions,
            toString(max(e.ts)) AS last_seen,
            any(e.route) AS route
       FROM ${RUM_EVENTS} AS e
      WHERE ${clause} AND e.event_type = 'error'
      GROUP BY error_type,
               replaceRegexpAll(
                 replaceRegexpAll(e.error_message, '[0-9a-f]{8}-[0-9a-f-]{27,}', '<id>'),
                 '\\d+', '<n>')
      ORDER BY count() DESC
      LIMIT 50`,
    { params },
  );
}

export type SessionRow = {
  session_id: string;
  started_at: string;
  ended_at: string;
  n_views: string;
  n_errors: string;
  lcp_p75: number;
  country: string;
  device: string;
  browser: string;
  entry_url: string;
};

export async function rumSessions(
  tenantId: string,
  w: RumWindow = {},
  limit = 50,
): Promise<SessionRow[]> {
  return read<SessionRow>(
    tenantId,
    // Every alias differs from the column it reads: `AS started` over
    // `toString(started)` replaces the column for the rest of the query, and
    // the WHERE below would compare its own String output to a DateTime.
    `SELECT session_id,
            toString(started) AS started_at,
            toString(ended) AS ended_at,
            toString(views) AS n_views,
            toString(errors) AS n_errors,
            lcp_p75, country, device, browser, entry_url
       FROM ${RUM_SESSIONS}
      WHERE started >= now() - INTERVAL {since:UInt32} HOUR
        ${w.appId ? "AND app_id = {app:UUID}" : ""}
      ORDER BY started DESC
      LIMIT {limit:UInt32}`,
    { params: { since: w.sinceHours ?? 24, limit, ...(w.appId ? { app: w.appId } : {}) } },
  );
}

/** One session's events, in order — the timeline a person reads after a complaint. */
export async function rumSession(
  tenantId: string,
  sessionId: string,
): Promise<
  Array<{
    at: string;
    event_type: string;
    url: string;
    route: string;
    vital_name: string;
    vital_value: number;
    vital_rating: string;
    error_type: string;
    error_message: string;
    trace_id: string;
  }>
> {
  return read(
    tenantId,
    `SELECT toString(e.ts) AS at, e.event_type AS event_type, e.url AS url, e.route AS route,
            e.vital_name AS vital_name, e.vital_value AS vital_value, e.vital_rating AS vital_rating,
            e.error_type AS error_type, e.error_message AS error_message, e.trace_id AS trace_id
       FROM ${RUM_EVENTS} AS e
      WHERE e.session_id = {session:String}
      ORDER BY e.ts ASC
      LIMIT 500`,
    { params: { session: sessionId } },
  );
}

/** Which applications have reported at all, for the picker. */
export async function rumApps(
  tenantId: string,
  sinceHours = 24,
): Promise<Array<{ app_id: string; views: string; sessions: string }>> {
  return read(
    tenantId,
    `SELECT toString(e.app_id) AS app_id,
            toString(uniq(e.view_id)) AS views,
            toString(uniq(e.session_id)) AS sessions
       FROM ${RUM_EVENTS} AS e
      WHERE e.ts >= now() - INTERVAL {since:UInt32} HOUR
      GROUP BY app_id`,
    { params: { since: sinceHours } },
  );
}

/**
 * Whether these sessions have a recording, asked for a page of them at once.
 *
 * A set rather than a flag per row, and one query rather than one per session:
 * the list screen shows fifty sessions and asking fifty times would be fifty
 * round trips to answer a question worth one badge.
 */
export async function rumReplayed(tenantId: string, sessionIds: string[]): Promise<Set<string>> {
  if (sessionIds.length === 0) return new Set();
  const rows = await read<{ session_id: string }>(
    tenantId,
    `SELECT r.session_id AS session_id
       FROM ${RUM_REPLAYS} AS r
      WHERE r.session_id IN {ids:Array(String)}`,
    { params: { ids: sessionIds } },
  );
  return new Set(rows.map((r) => r.session_id));
}

/**
 * The recording of one session, in order, as the events themselves.
 *
 * The payloads are concatenated here rather than in the player, because the
 * chunk boundary is an artefact of how a browser had to send it and means
 * nothing to a person watching. `seq` is the browser's own counter: ordering
 * by arrival would put a chunk that was retried after one recorded later, and
 * rrweb applied out of order does not look wrong, it throws.
 */
export async function rumReplay(
  tenantId: string,
  sessionId: string,
): Promise<{ events: unknown[]; chunks: number; bytes: number }> {
  const rows = await read<{ payload: string }>(
    tenantId,
    `SELECT c.payload AS payload
       FROM ${RUM_REPLAY_CHUNKS} AS c
      WHERE c.session_id = {session:String}
      ORDER BY c.seq ASC`,
    { params: { session: sessionId } },
  );
  const events: unknown[] = [];
  let bytes = 0;
  for (const row of rows) {
    bytes += row.payload.length;
    try {
      const part: unknown = JSON.parse(row.payload);
      if (Array.isArray(part)) events.push(...part);
    } catch {
      // A chunk that will not parse is skipped, not fatal. Losing one is a gap
      // in the recording; refusing the session loses all of it.
    }
  }
  return { events, chunks: rows.length, bytes };
}
