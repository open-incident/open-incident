-- T2 — exceptions (spec 15 §15.5, §15.4 step 5).
--
-- An exception is not a log with a stack trace in it. It is an event that
-- groups: the same bug fires ten thousand times and must appear once, with a
-- count and a first-seen, or the screen is unreadable exactly when it matters.
-- The grouping key is the `fingerprint`, computed at ingestion and never
-- recomputed at read — a fingerprint that changed when we improved the
-- algorithm would split a group in two and reset its history.

CREATE TABLE IF NOT EXISTS otel_exceptions
(
    tenant_id       UUID,
    service_id      UUID,
    service_name    LowCardinality(String),
    environment     LowCardinality(String) DEFAULT '',
    release         LowCardinality(String) DEFAULT '',
    ts              DateTime64(9) CODEC(Delta, ZSTD(1)),
    fingerprint     String,
    type            LowCardinality(String),
    message         String CODEC(ZSTD(3)),
    stacktrace      String CODEC(ZSTD(3)),
    frames          Array(Tuple(function String, file String, line UInt32, col UInt32, in_app Bool)),
    trace_id        String DEFAULT '',
    span_id         String DEFAULT '',
    attributes      Map(LowCardinality(String), String),
    retention_at    DateTime,

    INDEX idx_fingerprint fingerprint TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_trace       trace_id    TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY toDate(ts)
ORDER BY (tenant_id, fingerprint, ts)
TTL retention_at DELETE;

-- The groups list, hourly. Releases and services are arrays rather than a
-- single value because the interesting question is "did this start with a
-- release", and that needs the set, not the latest.
CREATE TABLE IF NOT EXISTS exception_groups_1h
(
    tenant_id    UUID,
    fingerprint  String,
    hour         DateTime,
    type         SimpleAggregateFunction(any, LowCardinality(String)),
    message      SimpleAggregateFunction(any, String),
    count        AggregateFunction(count),
    first_seen   SimpleAggregateFunction(min, DateTime),
    last_seen    SimpleAggregateFunction(max, DateTime),
    releases     AggregateFunction(groupUniqArray, LowCardinality(String)),
    services     AggregateFunction(groupUniqArray, LowCardinality(String))
)
ENGINE = AggregatingMergeTree
PARTITION BY toDate(hour)
ORDER BY (tenant_id, fingerprint, hour);

CREATE MATERIALIZED VIEW IF NOT EXISTS exception_groups_1h_mv TO exception_groups_1h AS
SELECT
    e.tenant_id AS tenant_id,
    e.fingerprint AS fingerprint,
    toStartOfHour(e.ts) AS hour,
    any(e.type) AS type,
    any(e.message) AS message,
    countState() AS count,
    min(toDateTime(e.ts)) AS first_seen,
    max(toDateTime(e.ts)) AS last_seen,
    groupUniqArrayState(e.release) AS releases,
    groupUniqArrayState(e.service_name) AS services
FROM otel_exceptions AS e
GROUP BY tenant_id, fingerprint, hour;

CREATE VIEW IF NOT EXISTS otel_exceptions_t AS
SELECT * FROM otel_exceptions WHERE tenant_id = {tenant:UUID};

-- The groups list as the screen reads it: one row per fingerprint, merged
-- across hours.
CREATE VIEW IF NOT EXISTS exception_groups_t AS
SELECT
    g.tenant_id AS tenant_id,
    g.fingerprint AS fingerprint,
    any(g.type) AS type,
    any(g.message) AS message,
    countMerge(g.count) AS occurrences,
    min(g.first_seen) AS first_seen,
    max(g.last_seen) AS last_seen,
    groupUniqArrayMerge(g.releases) AS releases,
    groupUniqArrayMerge(g.services) AS services
FROM exception_groups_1h AS g
WHERE g.tenant_id = {tenant:UUID}
GROUP BY tenant_id, fingerprint;
