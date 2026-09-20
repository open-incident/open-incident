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
import { compileFilter } from "./filter";
import { EXCEPTIONS, EXCEPTION_GROUPS, LOGS, MINUTES, SERIES, SPANS, TRACES } from "./views";

/**
 * The sources a query may name.
 *
 * A ClickHouse parameterized view is invoked like a table function, not like a
 * table — `otel_logs_t(tenant = …)`. That turns out to be exactly the property
 * we wanted: there is no spelling of these sources that omits the tenant, so
 * forgetting it is a syntax error rather than a leak. These constants are the
 * only correct spelling, and callers interpolate them.
 */
export {
  LOGS,
  SPANS,
  TRACES,
  SERIES,
  MINUTES,
  EXCEPTIONS,
  EXCEPTION_GROUPS,
  TENANT_VIEWS,
  type TenantView,
} from "./views";

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
  /\b(otel_logs|otel_spans|otel_traces_index|otel_metrics_gauge|otel_metrics_sum|otel_metrics_histogram|metric_series|metric_1m|otel_exceptions|exception_groups_1h|otel_profiles|profile_stacks|rum_events|rum_sessions_agg)(?!_t\s*\()\b/;

export type ReadOptions = {
  /** Extra bound parameters. `tenant` is reserved and set by this function. */
  params?: Record<string, unknown>;
  /** Hard ceiling for one query; the screens pass their own page size. */
  maxRows?: number;
  /** Wall-clock budget. A dashboard that hangs is worse than one that says no. */
  timeoutSeconds?: number;
};

/*
 * An output alias that repeats the name of a column, and is then used again.
 *
 * In ClickHouse the alias replaces the column for the rest of the query, so
 * `toString(minute) AS minute` makes every later mention of `minute` a String
 * — and a `WHERE minute >= {d:DateTime}` fails with "no supertype", or worse,
 * an aggregate silently receives its own output. This has cost six queries
 * here, each found by running it, and the error ClickHouse gives names neither
 * the alias nor the column.
 *
 * The second half of the rule matters as much as the first. `toString(ts) AS
 * ts` in a select that never mentions `ts` again is harmless and common, and a
 * check that refused it would be a check people route around. Only a name that
 * is *used* after being shadowed is a problem.
 */
function shadowingAlias(sql: string): { fn: string; column: string } | null {
  const pattern = /\b(\w+)\s*\(\s*(?:\w+\.)?(\w+)[^()]*\)\s+AS\s+(\w+)\b/gi;
  for (const m of sql.matchAll(pattern)) {
    const [whole, fn, column, alias] = m;
    if (!fn || !column || alias !== column) continue;
    const after = sql.slice((m.index ?? 0) + whole.length);
    // Qualified or bare, but as a whole word: `minute` must not match
    // `minutes` or `metric_1m_t`.
    if (new RegExp(`(?:^|[^\\w.])(?:\\w+\\.)?${column}\\b`).test(after)) {
      return { fn, column };
    }
  }
  return null;
}

export async function read<T>(tenantId: string, sql: string, opts: ReadOptions = {}): Promise<T[]> {
  const shadow = shadowingAlias(sql);
  if (shadow) {
    throw new Error(
      `"${shadow.fn}(${shadow.column}) AS ${shadow.column}" shadows the column it reads, and ` +
        `${shadow.column} is used again later: in ClickHouse the alias replaces the column for the ` +
        `rest of the query. Name the output something else.`,
    );
  }
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

/**
 * The Logs screen: most recent first, narrowed by whatever was asked.
 *
 * `filter` is the same one-line language the telemetry monitors take, compiled
 * by the same function. That is the point: a filter somebody typed here to
 * find a problem is a filter they can turn into a monitor without rewriting
 * it, and a language that behaves differently in the two places is a language
 * nobody trusts in either.
 */
export async function recentLogs(
  tenantId: string,
  opts: { limit?: number; traceId?: string; service?: string; filter?: string } = {},
): Promise<LogRow[]> {
  const where = ["1 = 1"];
  const params: Record<string, unknown> = { limit: opts.limit ?? 100 };
  if (opts.traceId) {
    where.push("trace_id = {traceId:String}");
    params.traceId = opts.traceId;
  }
  if (opts.service) {
    where.push("service_name = {service:String}");
    params.service = opts.service;
  }
  if (opts.filter?.trim()) {
    const compiled = compileFilter("logs", opts.filter);
    where.push(compiled.sql);
    Object.assign(params, compiled.params);
  }
  return read<LogRow>(
    tenantId,
    `SELECT ts, service_name, environment, severity_number, severity_text, body, trace_id, span_id
       FROM ${LOGS}
      WHERE ${where.join(" AND ")}
      ORDER BY ts DESC
      LIMIT {limit:UInt32}`,
    { params },
  );
}

export type TraceRow = {
  trace_id: string;
  start_ts: string;
  duration_ns: string;
  root_service: string;
  root_name: string;
  /** The root span's HTTP status. 0 when the trace is not an HTTP request. */
  root_status: number;
  span_count: string;
  error_count: string;
  services: string[];
  has_exception: boolean;
};

/** The Traces screen: one line per trace, newest first. */
export async function recentTraces(
  tenantId: string,
  opts: { limit?: number; service?: string; filter?: string } = {},
): Promise<TraceRow[]> {
  // Any trace the service took part in, not only the ones it started: during
  // an incident the interesting trace is usually one this service was called
  // from, and filtering on the root would hide every one of them.
  const where: string[] = [];
  const params: Record<string, unknown> = { limit: opts.limit ?? 100 };
  if (opts.service) {
    where.push("has(services, {service:String})");
    params.service = opts.service;
  }
  if (opts.filter?.trim()) {
    /*
     * The filter names span fields, and this table is one row per trace. So it
     * is applied as "a trace with at least one span that matches", through a
     * subquery on the spans — which is what somebody typing
     * `status_code = 'error'` into a trace list means.
     */
    const compiled = compileFilter("traces", opts.filter);
    where.push(`trace_id IN (SELECT trace_id FROM ${SPANS} WHERE ${compiled.sql} LIMIT 10000)`);
    Object.assign(params, compiled.params);
  }
  return read<TraceRow>(
    tenantId,
    `SELECT trace_id, start_ts, duration_ns, root_service, root_name, root_status,
            span_count, error_count, services, has_exception
       FROM ${TRACES}
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY start_ts DESC
      LIMIT {limit:UInt32}`,
    { params },
  );
}

export type SpanEventRow = { ts: string; name: string; attributes: Record<string, string> };

export type SpanRow = {
  span_id: string;
  parent_span_id: string;
  service_name: string;
  name: string;
  kind: string;
  status_code: string;
  status_message: string;
  start_ts: string;
  duration_ns: string;
  http_status_code: number;
  attributes: Record<string, string>;
  events: SpanEventRow[];
};

/**
 * One trace, every span, with what the detail panel needs.
 *
 * The attributes, the status message and the events come back with the span
 * rather than in a second call, because a waterfall is read by clicking
 * through it: a request per click would make the panel feel slower than the
 * system it is describing, and a trace is bounded — it is one request's worth
 * of spans, not a table scan.
 */
export async function spansOfTrace(tenantId: string, traceId: string): Promise<SpanRow[]> {
  return read<SpanRow>(
    tenantId,
    `SELECT span_id, parent_span_id, service_name, name, kind, status_code,
            status_message, start_ts, duration_ns, http_status_code, attributes,
            -- Selected as-is: a named tuple serialises to a JSON object with
            -- its field names, where wrapping it in arrayMap loses them and
            -- yields a positional array the reader has to decode by index.
            events
       FROM ${SPANS}
      WHERE trace_id = {traceId:String}
      ORDER BY start_ts ASC`,
    { params: { traceId } },
  );
}

export type LogPattern = {
  pattern: string;
  occurrences: string;
  services: string[];
  severity: number;
  first_seen: string;
  last_seen: string;
  sample: string;
};

/**
 * The log stream, folded into the shapes of line it contains.
 *
 * The same insight as the exception fingerprint, applied to logs: ten thousand
 * lines reading `user 4821 not found` are one thing that happened, and a
 * screen showing them one per row is unreadable exactly when it matters. What
 * a person needs at three in the morning is "these six shapes of line, and one
 * of them is new tonight".
 *
 * The normalisation runs in the column store rather than here, which is the
 * only way it scales: folding a million lines means reading a million lines,
 * and doing that in the application is a million rows over the wire to throw
 * away. The order of the replacements matters — URLs and paths before numbers,
 * or the digits inside a path are replaced first and the path stops looking
 * like one.
 */
export async function logPatterns(
  tenantId: string,
  opts: { sinceHours?: number; service?: string; filter?: string; limit?: number } = {},
): Promise<LogPattern[]> {
  const where = ["l.ts >= now() - INTERVAL {since:UInt32} HOUR"];
  const params: Record<string, unknown> = {
    since: opts.sinceHours ?? 24,
    limit: opts.limit ?? 60,
  };
  if (opts.service) {
    where.push("l.service_name = {service:String}");
    params.service = opts.service;
  }
  if (opts.filter?.trim()) {
    const compiled = compileFilter("logs", opts.filter);
    where.push(compiled.sql);
    Object.assign(params, compiled.params);
  }

  /*
   * Every backslash is doubled, and that is not belt and braces.
   *
   * ClickHouse parses a single-quoted literal with `\` as an escape character
   * before the regex engine ever sees it, so `\s` is a syntax error at the
   * backslash and `\1` in a replacement never reaches RE2. The pattern has to
   * arrive at the engine with its backslashes intact, which means writing two.
   */
  const NORMALISE = `
    replaceRegexpAll(
      replaceRegexpAll(
        replaceRegexpAll(
          replaceRegexpAll(
            replaceRegexpAll(l.body, 'https?://[^[:space:]\\'"]+', '<url>'),
            '[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}', '<uuid>'),
          '(^|[[:space:]])(/[^[:space:]\\'":]+)+', '\\\\1<path>'),
        '\\\\b[0-9a-fA-F]{16,}\\\\b', '<hex>'),
      '\\\\b[0-9][0-9_.,]*\\\\b', '<n>')`;

  return read<LogPattern>(
    tenantId,
    `SELECT ${NORMALISE} AS pattern,
            toString(count()) AS occurrences,
            groupUniqArray(10)(l.service_name) AS services,
            max(l.severity_number) AS severity,
            toString(min(l.ts)) AS first_seen,
            toString(max(l.ts)) AS last_seen,
            any(l.body) AS sample
       FROM ${LOGS} AS l
      WHERE ${where.join(" AND ")}
      GROUP BY pattern
      ORDER BY count() DESC
      LIMIT {limit:UInt32}`,
    { params, maxRows: 1_000 },
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
export async function exceptionGroups(
  tenantId: string,
  opts: { limit?: number; service?: string; filter?: string } = {},
): Promise<ExceptionGroup[]> {
  // `services` is the set a group was seen in, so narrowing to one service is
  // membership rather than equality: the same bug can fire in two of them.
  const clauses: string[] = [];
  const extra: Record<string, unknown> = {};
  if (opts.service) clauses.push("has(services, {service:String})");
  if (opts.filter?.trim()) {
    // Same shape as the traces filter: the fields belong to an occurrence, the
    // rows are groups, so the filter selects the fingerprints that have one.
    const compiled = compileFilter("exceptions", opts.filter);
    clauses.push(
      `fingerprint IN (SELECT fingerprint FROM ${EXCEPTIONS} WHERE ${compiled.sql} LIMIT 10000)`,
    );
    Object.assign(extra, compiled.params);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return read<ExceptionGroup>(
    tenantId,
    `SELECT fingerprint, type, message, toString(occurrences) AS occurrences,
            toString(first_seen) AS first_seen, toString(last_seen) AS last_seen,
            releases, services
       FROM ${EXCEPTION_GROUPS}
      ${where}
      ORDER BY last_seen DESC, occurrences DESC
      LIMIT {limit:UInt32}`,
    {
      params: {
        limit: opts.limit ?? 100,
        ...(opts.service ? { service: opts.service } : {}),
        ...extra,
      },
    },
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
