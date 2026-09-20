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

const RAW_TABLES = /\b(otel_logs|otel_spans|otel_traces_index)\b(?!_t\s*\()/;

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
