-- T0 — logs and traces (spec 15 §15.5).
--
-- Conventions that every table here follows, and that the next migrations must
-- keep: partition by day, tenant first in the sort key, per-row retention with
-- `TTL retention_at DELETE`, hot attributes promoted to typed columns and the
-- rest left in a Map.
--
-- One deliberate deviation from the spec, written down rather than hidden: it
-- asks for a text index on `body`. ClickHouse's full-text index is still
-- experimental in 25.3 and refuses to build without an experimental flag, so
-- the body carries a token bloom filter instead. It serves `hasToken()` — the
-- word search the Logs screen actually issues — and costs nothing to replace
-- the day the text index is stable.

CREATE TABLE IF NOT EXISTS otel_logs
(
    tenant_id           UUID,
    service_id          UUID,
    service_name        LowCardinality(String),
    environment         LowCardinality(String) DEFAULT '',
    ts                  DateTime64(9) CODEC(Delta, ZSTD(1)),
    observed_ts         DateTime64(9) CODEC(Delta, ZSTD(1)),
    severity_number     UInt8 DEFAULT 0,
    severity_text       LowCardinality(String) DEFAULT '',
    body                String CODEC(ZSTD(3)),
    trace_id            String DEFAULT '',
    span_id             String DEFAULT '',
    scope_name          LowCardinality(String) DEFAULT '',
    attributes          Map(LowCardinality(String), String),
    resource_attributes Map(LowCardinality(String), String),
    retention_at        DateTime,

    INDEX idx_body     body            TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 4,
    INDEX idx_trace    trace_id        TYPE bloom_filter(0.01)      GRANULARITY 4,
    INDEX idx_severity severity_number TYPE minmax                  GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY toDate(ts)
ORDER BY (tenant_id, service_name, ts)
TTL retention_at DELETE
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS otel_spans
(
    tenant_id           UUID,
    service_id          UUID,
    service_name        LowCardinality(String),
    environment         LowCardinality(String) DEFAULT '',
    service_version     LowCardinality(String) DEFAULT '',
    start_ts            DateTime64(9) CODEC(Delta, ZSTD(1)),
    end_ts              DateTime64(9) CODEC(Delta, ZSTD(1)),
    duration_ns         UInt64 CODEC(ZSTD(1)),
    trace_id            String,
    span_id             String,
    parent_span_id      String DEFAULT '',
    name                LowCardinality(String),
    kind                Enum8('unspecified' = 0, 'internal' = 1, 'server' = 2, 'client' = 3, 'producer' = 4, 'consumer' = 5),
    status_code         Enum8('unset' = 0, 'ok' = 1, 'error' = 2),
    status_message      String DEFAULT '',
    http_method         LowCardinality(String) DEFAULT '',
    http_route          LowCardinality(String) DEFAULT '',
    http_status_code    UInt16 DEFAULT 0,
    db_system           LowCardinality(String) DEFAULT '',
    rpc_service         LowCardinality(String) DEFAULT '',
    peer_service        LowCardinality(String) DEFAULT '',
    attributes          Map(LowCardinality(String), String),
    resource_attributes Map(LowCardinality(String), String),
    events              Array(Tuple(ts DateTime64(9), name String, attributes Map(LowCardinality(String), String))),
    links               Array(Tuple(trace_id String, span_id String)),
    has_exception       Bool DEFAULT false,
    sampled_ratio       Float32 DEFAULT 1,
    retention_at        DateTime,

    INDEX idx_trace    trace_id         TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_duration duration_ns      TYPE minmax             GRANULARITY 4,
    INDEX idx_http     http_status_code TYPE minmax             GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY toDate(start_ts)
ORDER BY (tenant_id, service_name, start_ts)
TTL retention_at DELETE
SETTINGS index_granularity = 8192;

-- The search list of the Traces screen. Spans of one trace arrive over time
-- and from several services, so the summary is kept as aggregate states and
-- merged at read time — a plain table would show a trace that is still
-- growing as if it were finished.
CREATE TABLE IF NOT EXISTS otel_traces_index
(
    tenant_id     UUID,
    trace_id      String,
    day           Date,
    start_ts      AggregateFunction(min, DateTime64(9)),
    end_ts        AggregateFunction(max, DateTime64(9)),
    root_service  AggregateFunction(argMin, LowCardinality(String), DateTime64(9)),
    root_name     AggregateFunction(argMin, LowCardinality(String), DateTime64(9)),
    span_count    AggregateFunction(count),
    error_count   AggregateFunction(sum, UInt64),
    services      AggregateFunction(groupUniqArray, LowCardinality(String)),
    has_exception AggregateFunction(max, UInt8),
    retention_at  AggregateFunction(max, DateTime)
)
ENGINE = AggregatingMergeTree
PARTITION BY day
ORDER BY (tenant_id, day, trace_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS otel_traces_index_mv TO otel_traces_index AS
SELECT
    s.tenant_id AS tenant_id,
    s.trace_id AS trace_id,
    toDate(s.start_ts) AS day,
    minState(s.start_ts) AS start_ts,
    maxState(s.end_ts) AS end_ts,
    argMinState(s.service_name, s.start_ts) AS root_service,
    argMinState(s.name, s.start_ts) AS root_name,
    countState() AS span_count,
    sumState(toUInt64(s.status_code = 'error')) AS error_count,
    groupUniqArrayState(s.service_name) AS services,
    maxState(toUInt8(s.has_exception)) AS has_exception,
    maxState(s.retention_at) AS retention_at
-- Every source column is qualified through `s`. Unqualified, a name that is
-- also an output alias resolves to the alias — an aggregate state — and the
-- view refuses to compile, twice over: once inside argMin, once in GROUP BY.
FROM otel_spans AS s
GROUP BY tenant_id, trace_id, day;

-- The tenant guard. These parameterized views are the only tables the query
-- layer is allowed to name: a query that forgets its tenant does not return
-- somebody else's rows, it fails to compile. `packages/telemetry` enforces it
-- and a test tries the raw table to prove the difference.
CREATE VIEW IF NOT EXISTS otel_logs_t AS
SELECT * FROM otel_logs WHERE tenant_id = {tenant:UUID};

CREATE VIEW IF NOT EXISTS otel_spans_t AS
SELECT * FROM otel_spans WHERE tenant_id = {tenant:UUID};

CREATE VIEW IF NOT EXISTS otel_traces_t AS
SELECT
    t.tenant_id AS tenant_id,
    t.trace_id AS trace_id,
    minMerge(t.start_ts) AS start_ts,
    maxMerge(t.end_ts) AS end_ts,
    dateDiff('nanosecond', minMerge(t.start_ts), maxMerge(t.end_ts)) AS duration_ns,
    argMinMerge(t.root_service) AS root_service,
    argMinMerge(t.root_name) AS root_name,
    countMerge(t.span_count) AS span_count,
    sumMerge(t.error_count) AS error_count,
    groupUniqArrayMerge(t.services) AS services,
    maxMerge(t.has_exception) > 0 AS has_exception
FROM otel_traces_index AS t
WHERE t.tenant_id = {tenant:UUID}
GROUP BY tenant_id, trace_id;
