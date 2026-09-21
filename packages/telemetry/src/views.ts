/**
 * The only correct spelling of every source a query may name.
 *
 * A ClickHouse parameterized view is invoked like a table function, not like a
 * table — `otel_logs_t(tenant = …)`. That turns out to be exactly the property
 * the isolation needs: there is no spelling of these sources that omits the
 * tenant, so forgetting it is a syntax error rather than a leak.
 *
 * They live in a module of their own, importing nothing, for a duller reason.
 * The query layer and the filter compiler both need them and each needs the
 * other — `read()` compiles a filter, and a filter names a source — which
 * under ESM is a cycle whose symptom is a constant that is `undefined` at
 * module load, on whichever of the two happens to be imported second. A leaf
 * module cannot be half-initialised.
 */

export const LOGS = "otel_logs_t(tenant = {tenant:UUID})";
export const SPANS = "otel_spans_t(tenant = {tenant:UUID})";
export const TRACES = "otel_traces_t(tenant = {tenant:UUID})";
/**
 * The trace list's source, and the window is part of the spelling.
 *
 * `TRACES` groups a workspace's whole history before the outer query can
 * discard any of it: on ten million spans that is 1.8 million rows and 373 MiB
 * of RAM to show a hundred lines. This one takes the window as parameters, so
 * a query against it can no more forget the window than it can forget the
 * tenant — and `day` is the partition key, so the pruning happens before
 * anything is merged. See sql/0011_trace_window.sql for the measurements.
 */
export const TRACES_WINDOW =
  "otel_traces_window_t(tenant = {tenant:UUID}, from = {from:Date}, to = {to:Date})";
export const SERIES = "metric_series_t(tenant = {tenant:UUID})";
export const MINUTES = "metric_1m_t(tenant = {tenant:UUID})";
export const EXCEPTIONS = "otel_exceptions_t(tenant = {tenant:UUID})";
export const EXCEPTION_GROUPS = "exception_groups_t(tenant = {tenant:UUID})";
export const EXCEPTION_HOURS = "exception_groups_1h_t(tenant = {tenant:UUID})";
export const EDGES = "service_edges_t(tenant = {tenant:UUID})";
export const EDGE_RUNS = "service_edge_runs_t(tenant = {tenant:UUID})";
export const PROFILES = "otel_profiles_t(tenant = {tenant:UUID})";
export const PROFILE_STACKS = "profile_stacks_t(tenant = {tenant:UUID})";
export const RUM_EVENTS = "rum_events_t(tenant = {tenant:UUID})";
export const RUM_SESSIONS = "rum_sessions_t(tenant = {tenant:UUID})";
export const RUM_REPLAYS = "rum_replays_t(tenant = {tenant:UUID})";
export const RUM_REPLAY_CHUNKS = "rum_replay_chunks_t(tenant = {tenant:UUID})";

export const TENANT_VIEWS = [LOGS, SPANS, TRACES] as const;
export type TenantView = (typeof TENANT_VIEWS)[number];
