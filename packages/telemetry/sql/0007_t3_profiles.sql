-- T3 — continuous profiling (spec 15 §15.5, §15.7).
--
-- A profile is a bag of (stack, value) pairs: "this call path burned 1.2
-- seconds of CPU". A flamegraph is that bag grouped by stack and summed over a
-- window, which is why the storage is shaped exactly like the question — no
-- tree is stored, because a tree is one way of drawing the answer and not the
-- answer itself.
--
-- The stacks live apart from the samples, keyed by a hash of their frames.
-- A profile of a busy service repeats the same few hundred call paths thousands
-- of times a minute; storing the frames beside every sample would make the
-- table an order of magnitude larger than the information in it.

CREATE TABLE IF NOT EXISTS otel_profiles
(
    tenant_id     UUID,
    service_id    UUID,
    service_name  LowCardinality(String),
    environment   LowCardinality(String) DEFAULT '',
    release       LowCardinality(String) DEFAULT '',
    ts            DateTime64(9) CODEC(Delta, ZSTD(1)),
    -- What was measured. `cpu` and `alloc_space` are the two anybody starts
    -- with; the rest are what a Go or JVM runtime offers alongside them.
    profile_type  LowCardinality(String),
    -- The unit the values are in — `nanoseconds`, `bytes`, `count`. Stored
    -- rather than inferred from the type, because a runtime is free to report
    -- CPU in samples instead of time and a flamegraph labelled in the wrong
    -- unit is a flamegraph nobody can compare.
    sample_unit   LowCardinality(String) DEFAULT '',
    period_ns     UInt64 DEFAULT 0,
    stack_id      UInt64,
    value         UInt64 CODEC(Delta, ZSTD(1)),
    labels        Map(LowCardinality(String), String),
    retention_at  DateTime,

    INDEX idx_stack stack_id TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY toDate(ts)
ORDER BY (tenant_id, service_name, profile_type, ts)
TTL retention_at DELETE;

-- The frames, once per distinct call path. `ReplacingMergeTree` because the
-- same stack arrives with every batch that contains it and the row is
-- identical every time: keeping one is the whole point.
CREATE TABLE IF NOT EXISTS profile_stacks
(
    tenant_id   UUID,
    stack_id    UInt64,
    -- Leaf first, as every profiler emits them and as a flamegraph reads them
    -- when inverted. "func file:line", one string per frame, because a tuple
    -- of three columns would be three columns nobody queries separately.
    frames      Array(String),
    -- False when the profiler sent addresses it could not resolve. Shown, not
    -- hidden: a flamegraph of hexadecimal is still useful to the one person
    -- who has the binary, and pretending it is symbolised is not.
    symbolized  Bool DEFAULT true,
    first_seen  DateTime DEFAULT now(),
    retention_at DateTime
)
ENGINE = ReplacingMergeTree(first_seen)
ORDER BY (tenant_id, stack_id)
TTL retention_at DELETE;

CREATE VIEW IF NOT EXISTS otel_profiles_t AS
SELECT * FROM otel_profiles WHERE tenant_id = {tenant:UUID};

CREATE VIEW IF NOT EXISTS profile_stacks_t AS
SELECT * FROM profile_stacks WHERE tenant_id = {tenant:UUID};
