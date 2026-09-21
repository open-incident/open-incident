-- A trace list that costs what it shows, not what the workspace has kept.
--
-- Measured on ten million spans (1.8 million traces), on the query the screen
-- was running:
--
--   no window   1 833 649 rows read · 211 MiB · 373 MiB of RAM · 230 ms
--   one day        48 406 rows read ·   5 MiB ·  21 MiB of RAM ·  22 ms
--
-- Thirty-eight times fewer rows for the same hundred lines on screen, and the
-- gap widens with every day of retention: the first figure is proportional to
-- everything stored, the second to what is being looked at. Note which limit
-- arrives first — 373 MiB of RAM for one page view. Time is not what breaks.
--
-- Two reasons the old query read everything, and the second is the one that
-- makes a window alone insufficient:
--
--  1. it had no time predicate at all, so no partition could be skipped;
--  2. `otel_traces_t` groups by (tenant_id, trace_id) with the tenant as its
--     only filter, so the whole of a workspace's history is aggregated before
--     the outer query's ORDER BY and LIMIT can discard any of it.
--
-- Hence a second view rather than a changed one. `otel_traces_window_t` takes
-- the window as parameters, so a query against it cannot forget the window any
-- more than it can forget the tenant — the same property, for the same reason.
-- `day` is the table's partition key and the second column of its sort key, so
-- the predicate prunes partitions and granules before anything is merged.
--
-- The old view stays, untouched, for the SQL explorer: somebody writing their
-- own query there is entitled to look across all of it, and a required
-- parameter they cannot pass would take the table away from them instead.
--
-- Why not simply expose `day` on the existing view and let callers filter on
-- it: grouping by day splits a trace that crosses midnight into two partial
-- traces. Rare — a three-second trace has one chance in thirty thousand — but
-- this view groups by (tenant_id, trace_id) and filters on the raw `day`
-- column, which prunes and keeps such a trace whole, as long as the window
-- covers both of its days.
CREATE OR REPLACE VIEW otel_traces_window_t AS
SELECT
    t.tenant_id AS tenant_id,
    t.trace_id AS trace_id,
    minMerge(t.start_ts) AS start_ts,
    maxMerge(t.end_ts) AS end_ts,
    dateDiff('nanosecond', minMerge(t.start_ts), maxMerge(t.end_ts)) AS duration_ns,
    argMinMerge(t.root_service) AS root_service,
    argMinMerge(t.root_name) AS root_name,
    argMinMerge(t.root_status) AS root_status,
    countMerge(t.span_count) AS span_count,
    sumMerge(t.error_count) AS error_count,
    groupUniqArrayMerge(t.services) AS services,
    maxMerge(t.has_exception) > 0 AS has_exception
FROM otel_traces_index AS t
WHERE t.tenant_id = {tenant:UUID}
  AND t.day >= {from:Date}
  AND t.day <= {to:Date}
GROUP BY
    tenant_id,
    trace_id;
