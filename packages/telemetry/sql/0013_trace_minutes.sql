-- Latency over a window, without reading the window.
--
-- The trace screen drew a scatter: one dot per sampled trace, with the
-- window's real quantiles as rules across it. Measured on 22 million spans
-- (1.5 million traces), that screen took 5 s over a day and **22 s over a
-- week**, and at a week it drew nothing at all before the request gave up.
--
-- The reason is not a missing index. A dot is one trace, and `LIMIT n BY
-- bucket` has to read every trace in the window to know which n fall in each
-- bucket; the quantiles have to read every duration. Both are O(traces in the
-- window) by construction, so no amount of pruning fixes a seven-day view —
-- the work is the window.
--
-- So the shape of a window comes from a rollup, one row per minute per root
-- service, and the exact dots stay for the short windows where they are worth
-- their cost. What this buys, on the same data:
--
--   7 days · from the traces  ~7 000 000 rows merged   22 s
--   7 days · from this rollup      ~50 000 rows         (see the screen)
--
-- Root spans only — `parent_span_id = ''`. A root span's duration is what the
-- caller waited, and its status is whether the caller got an error, which are
-- the two things a latency chart is asked about. Counting every span instead
-- would answer "how long did the average unit of work take", a number nobody
-- has ever needed.
--
-- Quantile *states*, not numbers: `quantileState` merges correctly across
-- minutes, so a seven-day p99 read from this rollup is the p99 of the seven
-- days and not an average of daily p99s — the mistake that makes a rollup
-- worse than useless for the one number people quote.
CREATE TABLE IF NOT EXISTS trace_1m
(
    tenant_id UUID,
    minute DateTime,
    root_service LowCardinality(String),
    traces AggregateFunction(count),
    errors AggregateFunction(sum, UInt64),
    p50 AggregateFunction(quantile(0.5), UInt64),
    p95 AggregateFunction(quantile(0.95), UInt64),
    p99 AggregateFunction(quantile(0.99), UInt64),
    slowest AggregateFunction(max, UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toDate(minute)
ORDER BY (tenant_id, root_service, minute)
TTL minute + INTERVAL 366 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS trace_1m_mv TO trace_1m AS
SELECT
    s.tenant_id AS tenant_id,
    toStartOfMinute(s.start_ts) AS minute,
    s.service_name AS root_service,
    countState() AS traces,
    sumState(toUInt64(s.status_code = 'error')) AS errors,
    quantileState(0.5)(s.duration_ns) AS p50,
    quantileState(0.95)(s.duration_ns) AS p95,
    quantileState(0.99)(s.duration_ns) AS p99,
    maxState(s.duration_ns) AS slowest
FROM otel_spans AS s
WHERE s.parent_span_id = ''
GROUP BY
    tenant_id,
    minute,
    root_service;

-- The read side, with the tenant in the only correct spelling of the source.
CREATE OR REPLACE VIEW trace_1m_t AS
SELECT
    r.tenant_id AS tenant_id,
    r.minute AS minute,
    r.root_service AS root_service,
    countMerge(r.traces) AS traces,
    sumMerge(r.errors) AS errors,
    quantileMerge(0.5)(r.p50) AS p50_ns,
    quantileMerge(0.95)(r.p95) AS p95_ns,
    quantileMerge(0.99)(r.p99) AS p99_ns,
    maxMerge(r.slowest) AS slowest_ns
FROM trace_1m AS r
WHERE r.tenant_id = {tenant:UUID}
GROUP BY
    tenant_id,
    minute,
    root_service;
