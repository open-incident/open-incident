-- A p99 of a bucket, not an average of p99s.
--
-- `trace_1m_t` merges each minute's quantile states into numbers, which is
-- right for reading one minute and wrong for reading a window: re-aggregating
-- those numbers over two hours gives the mean of a hundred and twenty p99s,
-- and that is not the p99 of the two hours. It is always lower, it is lower by
-- an amount nobody can estimate, and it is the single most common way a
-- latency chart lies.
--
-- So the bucketing belongs inside the view, where the states are still states
-- and `quantileMerge` over a bucket is the quantile of that bucket. The window
-- and the bucket width are parameters for the same reason the tenant is: a
-- caller cannot forget them.
--
-- Measured on the same 22 million spans, over seven days: 10 081 rows read,
-- 3 MiB, 184 ms — against 7 million rows and 22 seconds reading the traces
-- themselves.
CREATE OR REPLACE VIEW trace_bands_t AS
SELECT
    r.tenant_id AS tenant_id,
    toStartOfInterval(r.minute, toIntervalSecond({step:UInt32})) AS bucket,
    countMerge(r.traces) AS traces,
    sumMerge(r.errors) AS errors,
    quantileMerge(0.5)(r.p50) AS p50_ns,
    quantileMerge(0.95)(r.p95) AS p95_ns,
    quantileMerge(0.99)(r.p99) AS p99_ns,
    maxMerge(r.slowest) AS slowest_ns
FROM trace_1m AS r
WHERE r.tenant_id = {tenant:UUID}
  AND r.minute >= {from:DateTime}
  AND r.minute <= {to:DateTime}
GROUP BY
    tenant_id,
    bucket;
