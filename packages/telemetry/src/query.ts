/**
 * Reading telemetry — through the tenant, never around it.
 *
 * Rule 17 of spec 11 and §15.2 of spec 15 say the same thing: the tenant
 * filter is not something a caller remembers, it is something the layer
 * imposes. In Postgres that is row-level security. ClickHouse has no dynamic
 * row policy per tenant, so the equivalent here is a pair of parameterized
 * views — `otel_logs_t`, `otel_spans_t`, `otel_traces_t` — which do not
 * compile without `{tenant:UUID}`.
 *
 * `read()` is therefore the only door: it names one of those views, binds the
 * tenant itself, and refuses a query that mentions a raw table. A forgotten
 * filter is not a leak here, it is a failed query — which is the whole point
 * of the design.
 */
import { clickhouse, telemetryInstalled } from "./client";

/**
 * The sources a query may name.
 *
 * A ClickHouse parameterized view is invoked like a table function, not like a
 * table — `otel_logs_t(tenant = …)`. That turns out to be exactly the property
 * we wanted: there is no spelling of these sources that omits the tenant, so
 * forgetting it is a syntax error rather than a leak. These constants are the
 * only correct spelling, and callers interpolate them.
 */
export const LOGS = "otel_logs_t(tenant = {tenant:UUID})";
export const SPANS = "otel_spans_t(tenant = {tenant:UUID})";
export const TRACES = "otel_traces_t(tenant = {tenant:UUID})";

export const TENANT_VIEWS = [LOGS, SPANS, TRACES] as const;
export type TenantView = (typeof TENANT_VIEWS)[number];

/*
 * The tables the query layer may not name directly.
 *
 * The lookahead sits before the word boundary, and that order is the whole
 * subtlety: written after it, `otel_metrics_\w+` swallows the `_t` of the
 * parameterized view, the exemption never applies, and the guard refuses the
 * one spelling it is supposed to bless. Each table is therefore listed
 * explicitly rather than matched by prefix.
 */
const RAW_TABLES =
  /\b(otel_logs|otel_spans|otel_traces_index|otel_metrics_gauge|otel_metrics_sum|otel_metrics_histogram|metric_series|metric_1m|otel_exceptions|exception_groups_1h)(?!_t\s*\()\b/;

export type ReadOptions = {
  /** Extra bound parameters. `tenant` is reserved and set by this function. */
  params?: Record<string, unknown>;
  /** Hard ceiling for one query; the screens pass their own page size. */
  maxRows?: number;
  /** Wall-clock budget. A dashboard that hangs is worse than one that says no. */
  timeoutSeconds?: number;
};

export async function read<T>(tenantId: string, sql: string, opts: ReadOptions = {}): Promise<T[]> {
  if (RAW_TABLES.test(sql)) {
    throw new Error(
      "telemetry query names a raw table; interpolate LOGS, SPANS or TRACES so the tenant cannot be forgotten",
    );
  }
  if (opts.params && "tenant" in opts.params) {
    throw new Error("the tenant parameter is bound by the query layer, not by the caller");
  }
  const rs = await clickhouse().query({
    query: sql,
    format: "JSONEachRow",
    query_params: { tenant: tenantId, ...(opts.params ?? {}) },
    clickhouse_settings: {
      max_result_rows: String(opts.maxRows ?? 10_000),
      max_execution_time: opts.timeoutSeconds ?? 20,
      // Without this, max_result_rows truncates silently and the screen shows
      // a partial answer as if it were the answer.
      result_overflow_mode: "throw",
    },
  });
  return rs.json<T>();
}

export type LogRow = {
  ts: string;
  service_name: string;
  environment: string;
  severity_number: number;
  severity_text: string;
  body: string;
  trace_id: string;
  span_id: string;
};

/** The Logs screen: most recent first, optionally narrowed to one trace. */
export async function recentLogs(
  tenantId: string,
  opts: { limit?: number; traceId?: string; service?: string } = {},
): Promise<LogRow[]> {
  const where = ["1 = 1"];
  if (opts.traceId) where.push("trace_id = {traceId:String}");
  if (opts.service) where.push("service_name = {service:String}");
  return read<LogRow>(
    tenantId,
    `SELECT ts, service_name, environment, severity_number, severity_text, body, trace_id, span_id
       FROM ${LOGS}
      WHERE ${where.join(" AND ")}
      ORDER BY ts DESC
      LIMIT {limit:UInt32}`,
    {
      params: {
        limit: opts.limit ?? 100,
        ...(opts.traceId ? { traceId: opts.traceId } : {}),
        ...(opts.service ? { service: opts.service } : {}),
      },
    },
  );
}

export type TraceRow = {
  trace_id: string;
  start_ts: string;
  duration_ns: string;
  root_service: string;
  root_name: string;
  span_count: string;
  error_count: string;
  services: string[];
  has_exception: boolean;
};

/** The Traces screen: one line per trace, newest first. */
export async function recentTraces(
  tenantId: string,
  opts: { limit?: number } = {},
): Promise<TraceRow[]> {
  return read<TraceRow>(
    tenantId,
    `SELECT trace_id, start_ts, duration_ns, root_service, root_name,
            span_count, error_count, services, has_exception
       FROM ${TRACES}
      ORDER BY start_ts DESC
      LIMIT {limit:UInt32}`,
    { params: { limit: opts.limit ?? 100 } },
  );
}

export type SpanRow = {
  span_id: string;
  parent_span_id: string;
  service_name: string;
  name: string;
  kind: string;
  status_code: string;
  start_ts: string;
  duration_ns: string;
  http_status_code: number;
};

/** One trace, every span, ordered so the waterfall draws itself. */
export async function spansOfTrace(tenantId: string, traceId: string): Promise<SpanRow[]> {
  return read<SpanRow>(
    tenantId,
    `SELECT span_id, parent_span_id, service_name, name, kind, status_code,
            start_ts, duration_ns, http_status_code
       FROM ${SPANS}
      WHERE trace_id = {traceId:String}
      ORDER BY start_ts ASC`,
    { params: { traceId } },
  );
}

/** The tables a workspace's telemetry lives in — the purge's list, and the seed's. */
export const TENANT_TABLES = ["otel_logs", "otel_spans", "otel_traces_index"] as const;

/**
 * Erases a workspace's telemetry.
 *
 * Called by the product's purge, which verifies what it deleted rather than
 * trusting it — so this waits for the mutation instead of queueing it.
 * `mutations_sync = 2` means "when this returns, every replica has applied
 * it", which is the only setting under which the count that follows means
 * anything.
 *
 * Returns null when no column store is configured: an instance without the
 * module has no telemetry to erase, and saying "0 rows" would suggest we
 * looked.
 */
export async function purgeTenant(tenantId: string): Promise<number | null> {
  if (!telemetryInstalled()) return null;
  const ch = clickhouse();
  for (const table of TENANT_TABLES) {
    await ch.command({
      query: `DELETE FROM ${table} WHERE tenant_id = {tenant:UUID}`,
      query_params: { tenant: tenantId },
      clickhouse_settings: { mutations_sync: "2" },
    });
  }
  let left = 0;
  for (const table of TENANT_TABLES) {
    const rs = await ch.query({
      query: `SELECT count() AS n FROM ${table} WHERE tenant_id = {tenant:UUID}`,
      query_params: { tenant: tenantId },
      format: "JSONEachRow",
    });
    const [row] = await rs.json<{ n: string }>();
    left += Number(row?.n ?? 0);
  }
  return left;
}

export const SERIES = "metric_series_t(tenant = {tenant:UUID})";
export const MINUTES = "metric_1m_t(tenant = {tenant:UUID})";

export type MetricName = {
  metric_name: string;
  type: string;
  unit: string;
  series: string;
  last_seen: string;
};

/**
 * The catalogue, one line per metric name.
 *
 * `series` is the number of distinct label sets, and it is the number worth
 * looking at first: a metric with four series is a metric, a metric with forty
 * thousand is a mistake somebody has not noticed yet.
 */
export async function metricNames(tenantId: string, limit = 200): Promise<MetricName[]> {
  return read<MetricName>(
    tenantId,
    `SELECT metric_name, any(type) AS type, any(unit) AS unit,
            toString(count()) AS series, toString(max(last_seen)) AS last_seen
       FROM ${SERIES}
      GROUP BY metric_name
      ORDER BY metric_name
      LIMIT {limit:UInt32}`,
    { params: { limit } },
  );
}

export type MetricPointRow = { minute: string; value: number; attributes_hash: string };

/**
 * One metric over a window, per minute and per series.
 *
 * Read from the rollup, never from the points: a month of a busy counter is
 * millions of rows and forty thousand minutes, and the second number is the
 * one a chart can draw.
 */
export async function metricSeries(
  tenantId: string,
  metricName: string,
  opts: { hours?: number } = {},
): Promise<MetricPointRow[]> {
  return read<MetricPointRow>(
    tenantId,
    // Aliased through `m` for the third time in this file, and for the same
    // reason each time: `toString(minute) AS minute` shadows the column, and
    // the WHERE then compares a String to a DateTime. ClickHouse resolves an
    // output alias before the source column, so any name reused as an alias
    // has to be qualified.
    `SELECT toString(m.minute) AS minute, m.last AS value, toString(m.attributes_hash) AS attributes_hash
       FROM ${MINUTES} AS m
      WHERE m.metric_name = {name:String}
        AND m.minute >= now() - INTERVAL {hours:UInt32} HOUR
      ORDER BY m.minute`,
    { params: { name: metricName, hours: opts.hours ?? 24 } },
  );
}

export type SeriesLabels = { attributes_hash: string; attributes: Record<string, string> };

export async function seriesLabels(tenantId: string, metricName: string): Promise<SeriesLabels[]> {
  return read<SeriesLabels>(
    tenantId,
    `SELECT toString(attributes_hash) AS attributes_hash, attributes
       FROM ${SERIES}
      WHERE metric_name = {name:String}
      ORDER BY attributes_hash`,
    { params: { name: metricName } },
  );
}

/** Every label name a workspace's metrics carry, for `/api/v1/labels`. */
export async function labelNames(tenantId: string): Promise<string[]> {
  const rows = await read<{ k: string }>(
    tenantId,
    `SELECT DISTINCT arrayJoin(mapKeys(attributes)) AS k FROM ${SERIES} ORDER BY k`,
  );
  return ["__name__", ...rows.map((r) => r.k)];
}

/** The values one label takes, for `/api/v1/label/{name}/values`. */
export async function labelValues(tenantId: string, name: string): Promise<string[]> {
  if (name === "__name__") {
    const rows = await read<{ v: string }>(
      tenantId,
      `SELECT DISTINCT metric_name AS v FROM ${SERIES} ORDER BY v`,
    );
    return rows.map((r) => r.v);
  }
  const rows = await read<{ v: string }>(
    tenantId,
    `SELECT DISTINCT attributes[{name:String}] AS v
       FROM ${SERIES}
      WHERE mapContains(attributes, {name:String})
      ORDER BY v`,
    { params: { name } },
  );
  return rows.map((r) => r.v);
}

/** Every series as a label set, for `/api/v1/series`. */
export async function allSeries(
  tenantId: string,
  limit = 2000,
): Promise<Array<Record<string, string>>> {
  const rows = await read<{ n: string; a: Record<string, string> }>(
    tenantId,
    `SELECT metric_name AS n, attributes AS a FROM ${SERIES} ORDER BY n LIMIT {limit:UInt32}`,
    { params: { limit } },
  );
  return rows.map((r) => ({ __name__: r.n, ...r.a }));
}

/** Names with their type and unit, for `/api/v1/metadata`. */
export async function metricMetadata(
  tenantId: string,
): Promise<Record<string, Array<{ type: string; unit: string; help: string }>>> {
  const rows = await read<{ n: string; t: string; u: string }>(
    tenantId,
    `SELECT metric_name AS n, any(type) AS t, any(unit) AS u FROM ${SERIES} GROUP BY metric_name`,
  );
  const out: Record<string, Array<{ type: string; unit: string; help: string }>> = {};
  for (const r of rows) {
    // Prometheus' own vocabulary, so Grafana renders the right hints.
    const type = r.t === "sum" ? "counter" : r.t === "histogram" ? "histogram" : "gauge";
    out[r.n] = [{ type, unit: r.u, help: "" }];
  }
  return out;
}

export const EXCEPTIONS = "otel_exceptions_t(tenant = {tenant:UUID})";
export const EXCEPTION_GROUPS = "exception_groups_t(tenant = {tenant:UUID})";

export type ExceptionGroup = {
  fingerprint: string;
  type: string;
  message: string;
  occurrences: string;
  first_seen: string;
  last_seen: string;
  releases: string[];
  services: string[];
};

/** The groups list, worst first — most recent activity, then volume. */
export async function exceptionGroups(tenantId: string, limit = 100): Promise<ExceptionGroup[]> {
  return read<ExceptionGroup>(
    tenantId,
    `SELECT fingerprint, type, message, toString(occurrences) AS occurrences,
            toString(first_seen) AS first_seen, toString(last_seen) AS last_seen,
            releases, services
       FROM ${EXCEPTION_GROUPS}
      ORDER BY last_seen DESC, occurrences DESC
      LIMIT {limit:UInt32}`,
    { params: { limit } },
  );
}

export type ExceptionFrame = {
  function: string;
  file: string;
  line: number;
  col: number;
  in_app: boolean;
};

export type ExceptionOccurrence = {
  ts: string;
  service_name: string;
  release: string;
  trace_id: string;
  stacktrace: string;
  frames: ExceptionFrame[];
};

/** The most recent occurrence of a group, which is the one worth reading. */
export async function exceptionDetail(
  tenantId: string,
  fingerprint: string,
): Promise<ExceptionOccurrence | null> {
  const rows = await read<ExceptionOccurrence>(
    tenantId,
    `SELECT toString(ts) AS ts, service_name, release, trace_id, stacktrace, frames
       FROM ${EXCEPTIONS}
      WHERE fingerprint = {fp:String}
      ORDER BY ts DESC
      LIMIT 1`,
    { params: { fp: fingerprint } },
  );
  return rows[0] ?? null;
}
