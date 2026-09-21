-- Quantiles over a window, without a bucket: the same states, merged whole.
--
-- `trace_bands_t` buckets, which is what a chart needs and not what a headline
-- number needs. This one answers "the p99 of this window" — one row, merged
-- from the same states, so it is the real quantile of the window and not the
-- mean of a thousand bucketed ones.
--
-- The service is a parameter rather than an outer filter, and empty means all
-- of them. Grouping by service and letting the caller pick a row would hand a
-- caller who wanted "everything" the quantiles of whichever service came
-- first — which is exactly the bug the first version of this view had.
CREATE OR REPLACE VIEW trace_1m_all_t AS
SELECT
    r.tenant_id AS tenant_id,
    countMerge(r.traces) AS traces,
    sumMerge(r.errors) AS errors,
    quantileMerge(0.5)(r.p50) AS p50_ns,
    quantileMerge(0.95)(r.p95) AS p95_ns,
    quantileMerge(0.99)(r.p99) AS p99_ns
FROM trace_1m AS r
WHERE r.tenant_id = {tenant:UUID}
  AND r.minute >= {from:DateTime}
  AND r.minute <= {to:DateTime}
  AND ({service:String} = '' OR r.root_service = {service:String})
GROUP BY
    tenant_id;
