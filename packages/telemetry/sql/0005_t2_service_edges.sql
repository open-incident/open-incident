-- T2 — the service map's edges (spec 15 §15.5, §15.7).
--
-- An edge is "service A called service B", and no single span says that. The
-- caller writes a `client` span that names itself; the callee writes a
-- `server` span that names itself and carries the caller's span id as its
-- parent. The edge only exists once the two are put side by side.
--
-- That is why this is not a materialized view, which the specification's table
-- sketch suggested. A ClickHouse materialized view sees one inserted block: the
-- two spans of a call come from two different services, through two different
-- exporters, in two different inserts, so the join it would need is not
-- available to it — the view would silently produce nothing. The rollup is
-- therefore written by the worker, a minute at a time and a few minutes late,
-- which also gives the stragglers time to land.

CREATE TABLE IF NOT EXISTS service_edges_1m
(
    tenant_id      UUID,
    minute         DateTime,
    environment    LowCardinality(String) DEFAULT '',
    source_service LowCardinality(String),
    target_service LowCardinality(String),
    calls          AggregateFunction(count),
    errors         AggregateFunction(countIf, Bool),
    duration       AggregateFunction(quantiles(0.5, 0.95), UInt64),
    retention_at   DateTime
)
ENGINE = AggregatingMergeTree
PARTITION BY toDate(minute)
ORDER BY (tenant_id, minute, source_service, target_service, environment)
TTL retention_at DELETE;

CREATE VIEW IF NOT EXISTS service_edges_t AS
SELECT * FROM service_edges_1m WHERE tenant_id = {tenant:UUID};

-- Which minutes have already been rolled up, so a restart does not redo them
-- and a gap is visible rather than guessed at.
CREATE TABLE IF NOT EXISTS service_edge_runs
(
    tenant_id UUID,
    minute    DateTime,
    edges     UInt32,
    ran_at    DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(ran_at)
ORDER BY (tenant_id, minute);

CREATE VIEW IF NOT EXISTS service_edge_runs_t AS
SELECT * FROM service_edge_runs WHERE tenant_id = {tenant:UUID};
