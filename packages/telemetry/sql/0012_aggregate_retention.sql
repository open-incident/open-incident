-- The rollups outlived the data they summarise.
--
-- Every table of points expires on its own `retention_at`: spans, logs,
-- exceptions, the three metric tables, profiles, RUM events, replay chunks.
-- Every table *built from* those points had no TTL at all —
-- `otel_traces_index`, `metric_1m`, `exception_groups_1h`, `rum_sessions_agg`,
-- `service_edge_runs`. So a workspace on fifteen days of trace retention kept
-- one row per trace for ever, and one row per metric series per minute for
-- ever, long after the spans and the points were gone.
--
-- Found by asking what happens at millions of rows: the trace index is 128 MiB
-- for 1.8 million traces here, growing with every trace ever received and
-- never shrinking. That is the shape of a disk that fills quietly, which is
-- worse than one that fills loudly.
--
-- What this sets is a **ceiling, not the policy**. The product caps
-- configurable retention at 365 days, so 366 days on a rollup can never delete
-- something a workspace is still entitled to — and it does bound the growth.
-- The refinement this does not do: expiring a rollup exactly when its own
-- tenant's retention says so. `retention_at` on these tables is an
-- `AggregateFunction` state, which a TTL expression cannot read, so per-tenant
-- expiry needs either a `SimpleAggregateFunction` column (a column type change
-- and a materialised view rewrite) or a sweep issuing per-tenant deletes. It
-- is worth doing and it is not what stops the disk filling.
--
-- `day` and `minute` and `hour` are the partition keys, so a row's TTL is
-- decided by the partition it is already in: ClickHouse drops whole parts
-- rather than rewriting them, which is the cheap way for this to happen.
ALTER TABLE otel_traces_index
    MODIFY TTL toDateTime(day) + INTERVAL 366 DAY;

ALTER TABLE metric_1m
    MODIFY TTL toDateTime(minute) + INTERVAL 366 DAY;

ALTER TABLE exception_groups_1h
    MODIFY TTL toDateTime(hour) + INTERVAL 366 DAY;

ALTER TABLE rum_sessions_agg
    MODIFY TTL toDateTime(day) + INTERVAL 366 DAY;

-- The dependency map's own rollup. Unpartitioned and keyed by the minute it
-- covers, so the TTL is the only thing that will ever remove a row from it.
ALTER TABLE service_edge_runs
    MODIFY TTL toDateTime(minute) + INTERVAL 366 DAY;

-- Not `metric_series`: it is the catalogue the label pickers and the
-- cardinality budget read, one row per series rather than per point, and a
-- series that stopped reporting is exactly what somebody looks for when a
-- chart goes flat. It is bounded by the cardinality budget, which is the
-- ceiling that belongs to it.
