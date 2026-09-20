/**
 * Every service at once — the table the Telemetry screen opens on.
 *
 * The per-service card (`serviceWindow`) answers "is this one healthy"; this
 * answers "which one is not", which is the question somebody actually arrives
 * with. Two queries for the whole list rather than one per service: a
 * workspace with forty services would otherwise open forty round trips to draw
 * one table, and the second query is the sparkline, which cannot be folded
 * into the first without carrying every bucket of every service through the
 * same GROUP BY.
 *
 * Throughput is per second rather than a count, because a count is unreadable
 * without knowing the window it came from — and the window here is a control
 * on screen.
 */
import { read } from "./query";
import { SPANS } from "./views";

export type ServiceRow = {
  service: string;
  /** Spans per second over the window. */
  rps: number;
  /** Share of spans that failed, 0–1. */
  errorRate: number;
  errors: number;
  p99Ms: number;
  /** p95 per bucket over the window, oldest first — the shape, not the figure. */
  latency: number[];
  /**
   * The same two figures for the last quarter of the window, against the rest.
   *
   * A rate over an hour hides the thing worth seeing: an hour at 0.5 % that
   * spent its last ten minutes at 20 % reads as half a percent. These are what
   * says "this started recently", and the screen only claims a jump when the
   * recent share is both a multiple of the earlier one and made of enough
   * failures to mean something.
   */
  recentErrorRate: number;
  earlierErrorRate: number;
  recentErrors: number;
};

/** The buckets a sparkline is drawn from. Twelve over an hour is five minutes each. */
const BUCKETS = 12;

export async function servicesOverview(
  tenantId: string,
  sinceMinutes = 60,
  limit = 50,
): Promise<ServiceRow[]> {
  const bucketSeconds = Math.max(60, Math.round((sinceMinutes * 60) / BUCKETS));
  const recentMinutes = Math.max(5, Math.round(sinceMinutes / 4));
  const params = { minutes: sinceMinutes, bucket: bucketSeconds, limit, recent: recentMinutes };

  const rows = await read<{
    service: string;
    spans: string;
    errors: string;
    p99_ms: number;
    spans_recent: string;
    errors_recent: string;
  }>(
    tenantId,
    `SELECT s.service_name AS service,
            toString(count()) AS spans,
            toString(countIf(s.status_code = 'error')) AS errors,
            quantile(0.99)(s.duration_ns) / 1000000 AS p99_ms,
            toString(countIf(s.start_ts >= now() - INTERVAL {recent:UInt32} MINUTE)) AS spans_recent,
            toString(countIf(s.status_code = 'error'
                             AND s.start_ts >= now() - INTERVAL {recent:UInt32} MINUTE)) AS errors_recent
       FROM ${SPANS} AS s
      WHERE s.start_ts >= now() - INTERVAL {minutes:UInt32} MINUTE
        AND s.service_name != ''
      GROUP BY service
      ORDER BY count() DESC
      LIMIT {limit:UInt32}`,
    { params },
  );
  if (rows.length === 0) return [];

  /*
   * The shape, in one pass over the same window.
   *
   * `toStartOfInterval` and not a count of minutes: a bucket with no span must
   * be a hole in the line rather than a zero, and a zero here would draw a
   * service that went quiet as a service whose latency collapsed.
   */
  const shape = await read<{ service: string; slot: string; p95_ms: number }>(
    tenantId,
    `SELECT s.service_name AS service,
            toString(toUnixTimestamp(toStartOfInterval(s.start_ts, INTERVAL {bucket:UInt32} SECOND))) AS slot,
            quantile(0.95)(s.duration_ns) / 1000000 AS p95_ms
       FROM ${SPANS} AS s
      WHERE s.start_ts >= now() - INTERVAL {minutes:UInt32} MINUTE
        AND s.service_name != ''
      GROUP BY service, slot
      ORDER BY slot`,
    { params, maxRows: 5_000 },
  );

  const byService = new Map<string, number[]>();
  for (const row of shape) {
    const list = byService.get(row.service) ?? [];
    list.push(Number(row.p95_ms) || 0);
    byService.set(row.service, list);
  }

  const seconds = sinceMinutes * 60;
  return rows.map((r) => {
    const spans = Number(r.spans);
    const errors = Number(r.errors);
    const spansRecent = Number(r.spans_recent);
    const errorsRecent = Number(r.errors_recent);
    const spansEarlier = spans - spansRecent;
    const errorsEarlier = errors - errorsRecent;
    return {
      service: r.service,
      rps: spans / seconds,
      errors,
      errorRate: spans > 0 ? errors / spans : 0,
      p99Ms: Number.isFinite(r.p99_ms) ? r.p99_ms : 0,
      latency: byService.get(r.service) ?? [],
      recentErrorRate: spansRecent > 0 ? errorsRecent / spansRecent : 0,
      earlierErrorRate: spansEarlier > 0 ? errorsEarlier / spansEarlier : 0,
      recentErrors: errorsRecent,
    };
  });
}
