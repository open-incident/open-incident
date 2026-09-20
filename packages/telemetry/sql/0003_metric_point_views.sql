-- The point tables get their tenant views too.
--
-- The rollup answers anything longer than a week, but PromQL over a short
-- window has to read the points themselves: `rate()` over one-minute buckets
-- is an approximation, and on a five-minute graph the difference is visible.
-- So the evaluator needs a guarded way to reach them, and these are it.

CREATE VIEW IF NOT EXISTS otel_metrics_gauge_t AS
SELECT * FROM otel_metrics_gauge WHERE tenant_id = {tenant:UUID};

CREATE VIEW IF NOT EXISTS otel_metrics_sum_t AS
SELECT * FROM otel_metrics_sum WHERE tenant_id = {tenant:UUID};

CREATE VIEW IF NOT EXISTS otel_metrics_histogram_t AS
SELECT * FROM otel_metrics_histogram WHERE tenant_id = {tenant:UUID};
