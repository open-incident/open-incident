/**
 * What the Telemetry screen's Services and Metrics tabs read (design:
 * V2Telemetry, "Telemetry — Services" and "Telemetry — Metrics").
 *
 * Per service and per bucket, from the spans the service reported and the
 * metrics it sent: the golden signals from its entry spans (server and
 * consumer), its endpoints, what it calls (database, peers), and its runtime
 * metrics. Every function takes the window and the bucket width and returns
 * points on that grid — a bucket with nothing in it is absent, and the screen
 * draws a hole rather than a zero.
 *
 * All through `read()`, so all through the tenant guard.
 */
import { chTime, read } from "./query";
import { MINUTES, SERIES, SPANS } from "./views";

type Window = { from: Date; to: Date; stepSeconds: number };

const bounds = (w: Window) => ({
  fromTs: chTime(w.from),
  toTs: chTime(w.to),
  step: Math.max(1, Math.round(w.stepSeconds)),
});

/** A failed request, the way a person counts one: a 5xx, or an error with no HTTP status. */
const FAILED =
  "(s.http_status_code >= 500 OR (s.http_status_code = 0 AND s.status_code = 'error'))";
/** The spans where a request enters the service. */
const ENTRY = "s.kind IN ('server', 'consumer')";

export type GoldenBucket = {
  t: number;
  p50: number;
  p95: number;
  p99: number;
  total: number;
  c2xx: number;
  c4xx: number;
  c5xx: number;
};

/** Latency quantiles and traffic by status class, per bucket, from the entry spans. */
export async function serviceGolden(
  tenantId: string,
  service: string,
  w: Window,
): Promise<GoldenBucket[]> {
  const rows = await read<{
    t: string;
    p50: number;
    p95: number;
    p99: number;
    total: string;
    c2xx: string;
    c4xx: string;
    c5xx: string;
  }>(
    tenantId,
    `SELECT toString(intDiv(toUnixTimestamp(s.start_ts), {step:UInt32}) * {step:UInt32}) AS t,
            quantile(0.5)(s.duration_ns) / 1000000 AS p50,
            quantile(0.95)(s.duration_ns) / 1000000 AS p95,
            quantile(0.99)(s.duration_ns) / 1000000 AS p99,
            toString(count()) AS total,
            toString(countIf(NOT ${FAILED} AND (s.http_status_code < 400))) AS c2xx,
            toString(countIf(s.http_status_code >= 400 AND s.http_status_code < 500)) AS c4xx,
            toString(countIf(${FAILED})) AS c5xx
       FROM ${SPANS} AS s
      WHERE s.service_name = {service:String}
        AND ${ENTRY}
        AND s.start_ts >= {fromTs:DateTime64(9)} AND s.start_ts <= {toTs:DateTime64(9)}
      GROUP BY t
      ORDER BY t`,
    { params: { ...bounds(w), service }, maxRows: 5000 },
  );
  return rows.map((r) => ({
    t: Number(r.t) * 1000,
    p50: Number(r.p50),
    p95: Number(r.p95),
    p99: Number(r.p99),
    total: Number(r.total),
    c2xx: Number(r.c2xx),
    c4xx: Number(r.c4xx),
    c5xx: Number(r.c5xx),
  }));
}

/** How many distinct traces touched the service in the window — the zoom banner's count. */
export async function serviceTraceCount(
  tenantId: string,
  service: string,
  w: { from: Date; to: Date },
): Promise<number> {
  const [row] = await read<{ n: string }>(
    tenantId,
    `SELECT toString(uniq(s.trace_id)) AS n
       FROM ${SPANS} AS s
      WHERE s.service_name = {service:String}
        AND s.start_ts >= {fromTs:DateTime64(9)} AND s.start_ts <= {toTs:DateTime64(9)}`,
    { params: { service, fromTs: chTime(w.from), toTs: chTime(w.to) } },
  );
  return Number(row?.n ?? 0);
}

export type EndpointRow = {
  route: string;
  rps: number;
  errorRate: number;
  p50: number;
  p99: number;
  /** p99 per bucket over the window, oldest first, with the failed share. */
  spark: Array<{ p99: number; failed: number }>;
};

/** The service's endpoints, slowest p99 first, each with its p99 over the window. */
export async function serviceEndpoints(
  tenantId: string,
  service: string,
  w: { from: Date; to: Date },
  buckets = 30,
): Promise<EndpointRow[]> {
  const span = Math.max(60_000, w.to.getTime() - w.from.getTime());
  const step = Math.max(10, Math.round(span / buckets / 1000));
  const route =
    "if(s.http_route != '', concat(if(s.http_method != '', concat(s.http_method, ' '), ''), s.http_route), s.name)";
  const params = { service, fromTs: chTime(w.from), toTs: chTime(w.to), step };
  const rows = await read<{
    route: string;
    n: string;
    failed: string;
    p50: number;
    p99: number;
  }>(
    tenantId,
    `SELECT ${route} AS route,
            toString(count()) AS n,
            toString(countIf(${FAILED})) AS failed,
            quantile(0.5)(s.duration_ns) / 1000000 AS p50,
            quantile(0.99)(s.duration_ns) / 1000000 AS p99
       FROM ${SPANS} AS s
      WHERE s.service_name = {service:String} AND ${ENTRY}
        AND s.start_ts >= {fromTs:DateTime64(9)} AND s.start_ts <= {toTs:DateTime64(9)}
      GROUP BY route
      ORDER BY p99 DESC
      LIMIT 12`,
    { params },
  );
  if (rows.length === 0) return [];
  const spark = await read<{ route: string; t: string; p99: number; failed: string; n: string }>(
    tenantId,
    `SELECT ${route} AS route,
            toString(intDiv(toUnixTimestamp(s.start_ts), {step:UInt32}) * {step:UInt32}) AS t,
            quantile(0.99)(s.duration_ns) / 1000000 AS p99,
            toString(countIf(${FAILED})) AS failed,
            toString(count()) AS n
       FROM ${SPANS} AS s
      WHERE s.service_name = {service:String} AND ${ENTRY}
        AND s.start_ts >= {fromTs:DateTime64(9)} AND s.start_ts <= {toTs:DateTime64(9)}
        AND ${route} IN {routes:Array(String)}
      GROUP BY route, t
      ORDER BY t`,
    { params: { ...params, routes: rows.map((r) => r.route) }, maxRows: 5000 },
  );
  const start = Math.floor(w.from.getTime() / 1000 / step) * step;
  const seconds = span / 1000;
  return rows.map((r) => {
    const mine = new Map(
      spark
        .filter((x) => x.route === r.route)
        .map((x) => [
          Number(x.t),
          { p99: Number(x.p99), failed: Number(x.failed) / Math.max(1, Number(x.n)) },
        ]),
    );
    const out: EndpointRow["spark"] = [];
    for (let i = 0; i < buckets; i++) out.push(mine.get(start + i * step) ?? { p99: 0, failed: 0 });
    return {
      route: r.route,
      rps: Number(r.n) / seconds,
      errorRate: Number(r.failed) / Math.max(1, Number(r.n)),
      p50: Number(r.p50),
      p99: Number(r.p99),
      spark: out,
    };
  });
}

export type DependencyBucket = {
  t: number;
  /** `db` — a database call; `acquire` — waiting for a pooled connection; `peer` — any other call. */
  kind: "db" | "acquire" | "peer";
  /** The database system, or the peer's name. */
  target: string;
  /** The host the peer was reached on, when the span recorded it. */
  host: string;
  p50: number;
  p95: number;
  calls: number;
};

/**
 * What the service calls: databases, the wait for a pooled connection, and
 * every named peer — per bucket, from its client and internal spans.
 */
export async function serviceDependencies(
  tenantId: string,
  service: string,
  w: Window,
): Promise<DependencyBucket[]> {
  const rows = await read<{
    t: string;
    kind: "db" | "acquire" | "peer";
    target: string;
    host: string;
    p50: number;
    p95: number;
    calls: string;
  }>(
    tenantId,
    `SELECT toString(intDiv(toUnixTimestamp(s.start_ts), {step:UInt32}) * {step:UInt32}) AS t,
            multiIf(s.db_system != '', 'db', positionCaseInsensitive(s.name, 'acquire') > 0, 'acquire', 'peer') AS kind,
            multiIf(s.db_system != '', s.db_system, positionCaseInsensitive(s.name, 'acquire') > 0, s.name, s.peer_service) AS target,
            any(s.attributes['net.peer.name']) AS host,
            quantile(0.5)(s.duration_ns) / 1000000 AS p50,
            quantile(0.95)(s.duration_ns) / 1000000 AS p95,
            toString(count()) AS calls
       FROM ${SPANS} AS s
      WHERE s.service_name = {service:String}
        AND (s.db_system != '' OR s.peer_service != '' OR positionCaseInsensitive(s.name, 'acquire') > 0)
        AND s.kind IN ('client', 'producer', 'internal')
        AND s.start_ts >= {fromTs:DateTime64(9)} AND s.start_ts <= {toTs:DateTime64(9)}
      GROUP BY t, kind, target
      ORDER BY t`,
    { params: { ...bounds(w), service }, maxRows: 20_000 },
  );
  return rows.map((r) => ({
    t: Number(r.t) * 1000,
    kind: r.kind,
    target: r.target,
    host: r.host,
    p50: Number(r.p50),
    p95: Number(r.p95),
    calls: Number(r.calls),
  }));
}

export type MetricBucket = {
  metric: string;
  /** The `state` attribute when the metric has one (a pool's used / idle), else ''. */
  label: string;
  t: number;
  avg: number;
  max: number;
  /** Distinct series reporting in the bucket — pods, for a per-pod metric. */
  series: number;
};

/**
 * The service's own metrics over the window, by name, per bucket: the average
 * and the largest across its series (one per pod, typically).
 */
export async function serviceMetrics(
  tenantId: string,
  service: string,
  names: string[],
  w: Window,
): Promise<MetricBucket[]> {
  if (names.length === 0) return [];
  const rows = await read<{
    metric: string;
    label: string;
    t: string;
    avg: number;
    mx: number;
    n: string;
  }>(
    tenantId,
    `SELECT m.metric_name AS metric,
            c.attributes['state'] AS label,
            toString(intDiv(toUnixTimestamp(m.minute), {step:UInt32}) * {step:UInt32}) AS t,
            avg(m.last) AS avg,
            max(m.max) AS mx,
            toString(uniq(m.attributes_hash)) AS n
       FROM ${MINUTES} AS m
       INNER JOIN ${SERIES} AS c
          ON c.metric_name = m.metric_name AND c.attributes_hash = m.attributes_hash
      WHERE m.metric_name IN {names:Array(String)}
        AND m.service_name = {service:String}
        AND m.minute >= {fromTs:DateTime64(3)} AND m.minute <= {toTs:DateTime64(3)}
      GROUP BY metric, label, t
      ORDER BY t`,
    {
      params: {
        names,
        service,
        fromTs: chTime(w.from),
        toTs: chTime(w.to),
        step: Math.max(60, Math.round(w.stepSeconds)),
      },
      maxRows: 50_000,
    },
  );
  return rows.map((r) => ({
    metric: r.metric,
    label: r.label,
    t: Number(r.t) * 1000,
    avg: Number(r.avg),
    max: Number(r.mx),
    series: Number(r.n),
  }));
}

/** What a service's metrics say about where it runs: pods, and the runtime. */
export async function serviceRuntime(
  tenantId: string,
  service: string,
): Promise<{ pods: number; runtime: string | null }> {
  const [row] = await read<{ pods: string; runtime: string }>(
    tenantId,
    `SELECT toString(uniqIf(c.attributes['k8s.pod.name'], c.attributes['k8s.pod.name'] != '')) AS pods,
            anyIf(c.attributes['process.runtime.description'], c.attributes['process.runtime.description'] != '') AS runtime
       FROM ${SERIES} AS c
      WHERE c.service_name = {service:String}
        AND c.last_seen >= now() - INTERVAL 1 DAY`,
    { params: { service } },
  );
  return { pods: Number(row?.pods ?? 0), runtime: row?.runtime || null };
}

export type ServiceTableRow = {
  service: string;
  rps: number;
  errorRate: number;
  p99: number;
  /** p95 and the failed share per bucket, oldest first. */
  buckets: Array<{ p95: number; failed: number } | null>;
};

/**
 * Every service that sent a span in the window, busiest first — the Services
 * tab's table, with thirty buckets of latency each.
 */
export async function servicesTable(
  tenantId: string,
  w: { from: Date; to: Date },
  buckets = 30,
): Promise<ServiceTableRow[]> {
  const span = Math.max(60_000, w.to.getTime() - w.from.getTime());
  const step = Math.max(10, Math.round(span / buckets / 1000));
  const params = { fromTs: chTime(w.from), toTs: chTime(w.to), step };
  const rows = await read<{ service: string; n: string; failed: string; p99: number }>(
    tenantId,
    `SELECT s.service_name AS service,
            toString(countIf(${ENTRY})) AS n,
            toString(countIf(${ENTRY} AND ${FAILED})) AS failed,
            quantileIf(0.99)(s.duration_ns, ${ENTRY}) / 1000000 AS p99
       FROM ${SPANS} AS s
      WHERE s.start_ts >= {fromTs:DateTime64(9)} AND s.start_ts <= {toTs:DateTime64(9)}
        AND s.service_name != ''
      GROUP BY service
      ORDER BY count() DESC
      LIMIT 60`,
    { params },
  );
  if (rows.length === 0) return [];
  const shape = await read<{ service: string; t: string; p95: number; failed: string; n: string }>(
    tenantId,
    `SELECT s.service_name AS service,
            toString(intDiv(toUnixTimestamp(s.start_ts), {step:UInt32}) * {step:UInt32}) AS t,
            quantile(0.95)(s.duration_ns) / 1000000 AS p95,
            toString(countIf(${FAILED})) AS failed,
            toString(count()) AS n
       FROM ${SPANS} AS s
      WHERE s.start_ts >= {fromTs:DateTime64(9)} AND s.start_ts <= {toTs:DateTime64(9)}
        AND s.service_name != '' AND ${ENTRY}
      GROUP BY service, t`,
    { params, maxRows: 20_000 },
  );
  const start = Math.floor(w.from.getTime() / 1000 / step) * step;
  const seconds = span / 1000;
  return rows.map((r) => {
    const mine = new Map(
      shape
        .filter((x) => x.service === r.service)
        .map((x) => [
          Number(x.t),
          { p95: Number(x.p95), failed: Number(x.failed) / Math.max(1, Number(x.n)) },
        ]),
    );
    const out: ServiceTableRow["buckets"] = [];
    for (let i = 0; i < buckets; i++) out.push(mine.get(start + i * step) ?? null);
    const n = Number(r.n);
    return {
      service: r.service,
      rps: n / seconds,
      errorRate: n > 0 ? Number(r.failed) / n : 0,
      p99: Number.isFinite(r.p99) ? r.p99 : 0,
      buckets: out,
    };
  });
}

/** Spans per second over the last five minutes, and when the last one arrived. */
export async function receiving(
  tenantId: string,
): Promise<{ perSecond: number; lastAt: Date | null }> {
  const [row] = await read<{ n: string; last: string }>(
    tenantId,
    `SELECT toString(countIf(s.start_ts >= now() - INTERVAL 5 MINUTE)) AS n,
            toString(max(s.start_ts)) AS last
       FROM ${SPANS} AS s
      WHERE s.start_ts >= now() - INTERVAL 1 DAY`,
  );
  const last =
    row?.last && !row.last.startsWith("1970") ? new Date(`${row.last.replace(" ", "T")}Z`) : null;
  return { perSecond: Number(row?.n ?? 0) / 300, lastAt: last };
}
