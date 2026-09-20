-- The root span's HTTP status, on the trace index.
--
-- The traces list shows one line per trace, and the single most scannable
-- thing on such a line is `500` — it is how somebody finds the trace they came
-- for without opening nine of them. The index had the error *count*, which
-- answers "did anything fail" and not "what did the caller get": a trace whose
-- root returned 200 while an internal retry failed is a different story from
-- one that returned 504, and the count cannot tell them apart.
--
-- `argMin` by start time, like `root_service` and `root_name` beside it: the
-- earliest span of a trace is its root, and taking a max or an any would pick
-- whichever downstream call happened to carry a status.
ALTER TABLE otel_traces_index
    ADD COLUMN IF NOT EXISTS root_status AggregateFunction(argMin, UInt16, DateTime64(9));

-- A materialized view cannot be altered, only replaced. Dropping it loses
-- nothing that is already written — the index rows stay — but the window
-- between the drop and the create is a window where spans are not summarised,
-- so this runs as one migration rather than as two steps somebody might pause
-- between.
DROP VIEW IF EXISTS otel_traces_index_mv;

CREATE MATERIALIZED VIEW IF NOT EXISTS otel_traces_index_mv TO otel_traces_index AS
SELECT
    s.tenant_id AS tenant_id,
    s.trace_id AS trace_id,
    toDate(s.start_ts) AS day,
    minState(s.start_ts) AS start_ts,
    maxState(s.end_ts) AS end_ts,
    argMinState(s.service_name, s.start_ts) AS root_service,
    argMinState(s.name, s.start_ts) AS root_name,
    argMinState(toUInt16(s.http_status_code), s.start_ts) AS root_status,
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

-- The tenant view has to expose the new column, and a view cannot be altered
-- either. `CREATE OR REPLACE` keeps the name — nothing that references it has
-- to change, and the parameterised guard is preserved exactly as it was.
CREATE OR REPLACE VIEW otel_traces_t AS
SELECT
    t.tenant_id AS tenant_id,
    t.trace_id AS trace_id,
    minMerge(t.start_ts) AS start_ts,
    maxMerge(t.end_ts) AS end_ts,
    dateDiff('nanosecond', minMerge(t.start_ts), maxMerge(t.end_ts)) AS duration_ns,
    argMinMerge(t.root_service) AS root_service,
    argMinMerge(t.root_name) AS root_name,
    -- Zero for every trace summarised before this migration, and for anything
    -- that is not an HTTP request. The screen reads zero as "no badge" rather
    -- than as a status, which is the honest rendering of "we do not know".
    argMinMerge(t.root_status) AS root_status,
    countMerge(t.span_count) AS span_count,
    sumMerge(t.error_count) AS error_count,
    groupUniqArrayMerge(t.services) AS services,
    maxMerge(t.has_exception) > 0 AS has_exception
FROM otel_traces_index AS t
WHERE t.tenant_id = {tenant:UUID}
GROUP BY tenant_id, trace_id;
