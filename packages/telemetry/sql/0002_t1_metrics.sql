-- T1 — metrics (spec 15 §15.5).
--
-- One table per OTLP point type rather than one wide table: a gauge has a
-- value, a histogram has bounds and counts, and forcing them into the same
-- rows would store nulls by the billion and make every query choose a branch.
--
-- `attributes_hash` is what turns a bag of labels into a series. It is
-- computed at ingestion from the sorted key/value pairs, which is what lets
-- `metric_series` count cardinality and what lets a chart group without
-- reading the Map.
--
-- Exponential histograms and summaries are deliberately absent. They are rare
-- in practice and expensive to store well; a collector that sends them is told
-- so in the rejections rather than having its points dropped in silence.

CREATE TABLE IF NOT EXISTS otel_metrics_gauge
(
    tenant_id       UUID,
    service_id      UUID,
    service_name    LowCardinality(String),
    environment     LowCardinality(String) DEFAULT '',
    metric_name     LowCardinality(String),
    description     String DEFAULT '',
    unit            LowCardinality(String) DEFAULT '',
    ts              DateTime64(9) CODEC(Delta, ZSTD(1)),
    value           Float64 CODEC(Gorilla, ZSTD(1)),
    attributes      Map(LowCardinality(String), String),
    attributes_hash UInt64,
    exemplars       Array(Tuple(ts DateTime64(9), value Float64, trace_id String, span_id String)),
    retention_at    DateTime
)
ENGINE = MergeTree
PARTITION BY toDate(ts)
ORDER BY (tenant_id, metric_name, attributes_hash, ts)
TTL retention_at DELETE;

CREATE TABLE IF NOT EXISTS otel_metrics_sum
(
    tenant_id               UUID,
    service_id              UUID,
    service_name            LowCardinality(String),
    environment             LowCardinality(String) DEFAULT '',
    metric_name             LowCardinality(String),
    description             String DEFAULT '',
    unit                    LowCardinality(String) DEFAULT '',
    ts                      DateTime64(9) CODEC(Delta, ZSTD(1)),
    value                   Float64 CODEC(Gorilla, ZSTD(1)),
    -- Whether the series only ever goes up, and whether a point is a delta or
    -- a running total. A rate computed without knowing these is wrong twice.
    is_monotonic            Bool DEFAULT false,
    aggregation_temporality Enum8('unspecified' = 0, 'delta' = 1, 'cumulative' = 2) DEFAULT 'unspecified',
    attributes              Map(LowCardinality(String), String),
    attributes_hash         UInt64,
    exemplars               Array(Tuple(ts DateTime64(9), value Float64, trace_id String, span_id String)),
    retention_at            DateTime
)
ENGINE = MergeTree
PARTITION BY toDate(ts)
ORDER BY (tenant_id, metric_name, attributes_hash, ts)
TTL retention_at DELETE;

CREATE TABLE IF NOT EXISTS otel_metrics_histogram
(
    tenant_id               UUID,
    service_id              UUID,
    service_name            LowCardinality(String),
    environment             LowCardinality(String) DEFAULT '',
    metric_name             LowCardinality(String),
    description             String DEFAULT '',
    unit                    LowCardinality(String) DEFAULT '',
    ts                      DateTime64(9) CODEC(Delta, ZSTD(1)),
    count                   UInt64,
    sum                     Float64,
    min                     Float64 DEFAULT 0,
    max                     Float64 DEFAULT 0,
    bucket_counts           Array(UInt64),
    explicit_bounds         Array(Float64),
    aggregation_temporality Enum8('unspecified' = 0, 'delta' = 1, 'cumulative' = 2) DEFAULT 'unspecified',
    attributes              Map(LowCardinality(String), String),
    attributes_hash         UInt64,
    exemplars               Array(Tuple(ts DateTime64(9), value Float64, trace_id String, span_id String)),
    retention_at            DateTime
)
ENGINE = MergeTree
PARTITION BY toDate(ts)
ORDER BY (tenant_id, metric_name, attributes_hash, ts)
TTL retention_at DELETE;

-- The catalogue of series: what exists, since when, and how many there are.
-- This is the table the cardinality budget reads, and the one that fills a
-- label picker without scanning a month of points.
CREATE TABLE IF NOT EXISTS metric_series
(
    tenant_id       UUID,
    metric_name     LowCardinality(String),
    attributes_hash UInt64,
    type            LowCardinality(String),
    unit            LowCardinality(String) DEFAULT '',
    service_name    LowCardinality(String) DEFAULT '',
    attributes      Map(LowCardinality(String), String),
    first_seen      SimpleAggregateFunction(min, DateTime),
    last_seen       SimpleAggregateFunction(max, DateTime)
)
ENGINE = AggregatingMergeTree
ORDER BY (tenant_id, metric_name, attributes_hash);

-- Per-minute rollup, so a chart over a month reads minutes instead of points.
-- Gauges and sums share it; a histogram is summarised by its count and sum,
-- which is what a rate or an average needs.
CREATE TABLE IF NOT EXISTS metric_1m
(
    tenant_id       UUID,
    metric_name     LowCardinality(String),
    attributes_hash UInt64,
    minute          DateTime,
    service_name    LowCardinality(String),
    points          AggregateFunction(count),
    sum             AggregateFunction(sum, Float64),
    min             AggregateFunction(min, Float64),
    max             AggregateFunction(max, Float64),
    last            AggregateFunction(argMax, Float64, DateTime64(9)),
    retention_at    AggregateFunction(max, DateTime)
)
ENGINE = AggregatingMergeTree
PARTITION BY toDate(minute)
ORDER BY (tenant_id, metric_name, attributes_hash, minute);

CREATE MATERIALIZED VIEW IF NOT EXISTS metric_1m_gauge_mv TO metric_1m AS
SELECT
    g.tenant_id AS tenant_id,
    g.metric_name AS metric_name,
    g.attributes_hash AS attributes_hash,
    toStartOfMinute(g.ts) AS minute,
    g.service_name AS service_name,
    countState() AS points,
    sumState(g.value) AS sum,
    minState(g.value) AS min,
    maxState(g.value) AS max,
    argMaxState(g.value, g.ts) AS last,
    maxState(g.retention_at) AS retention_at
FROM otel_metrics_gauge AS g
GROUP BY tenant_id, metric_name, attributes_hash, minute, service_name;

CREATE MATERIALIZED VIEW IF NOT EXISTS metric_1m_sum_mv TO metric_1m AS
SELECT
    s.tenant_id AS tenant_id,
    s.metric_name AS metric_name,
    s.attributes_hash AS attributes_hash,
    toStartOfMinute(s.ts) AS minute,
    s.service_name AS service_name,
    countState() AS points,
    sumState(s.value) AS sum,
    minState(s.value) AS min,
    maxState(s.value) AS max,
    argMaxState(s.value, s.ts) AS last,
    maxState(s.retention_at) AS retention_at
FROM otel_metrics_sum AS s
GROUP BY tenant_id, metric_name, attributes_hash, minute, service_name;

-- The tenant guard, same rule as T0: these are the only spellings the query
-- layer may use, and none of them exists without a workspace.
CREATE VIEW IF NOT EXISTS metric_series_t AS
SELECT
    tenant_id,
    metric_name,
    attributes_hash,
    any(type) AS type,
    any(unit) AS unit,
    any(service_name) AS service_name,
    any(attributes) AS attributes,
    min(first_seen) AS first_seen,
    max(last_seen) AS last_seen
FROM metric_series
WHERE tenant_id = {tenant:UUID}
GROUP BY tenant_id, metric_name, attributes_hash;

CREATE VIEW IF NOT EXISTS metric_1m_t AS
SELECT
    m.tenant_id AS tenant_id,
    m.metric_name AS metric_name,
    m.attributes_hash AS attributes_hash,
    m.minute AS minute,
    any(m.service_name) AS service_name,
    countMerge(m.points) AS points,
    sumMerge(m.sum) AS sum,
    minMerge(m.min) AS min,
    maxMerge(m.max) AS max,
    argMaxMerge(m.last) AS last
FROM metric_1m AS m
WHERE m.tenant_id = {tenant:UUID}
GROUP BY tenant_id, metric_name, attributes_hash, minute;
