-- T3 — real user monitoring (spec 15 §15.5, §15.7).
--
-- What a browser sees, which is the one thing the rest of the telemetry cannot
-- tell you. A p95 of 40 ms at the edge and a page that takes four seconds to
-- become usable are both true at once, and only this table knows the second.
--
-- One wide table for every kind of event rather than one per kind. A session
-- is read as a timeline — a page view, three resources, a long task, an error
-- — and splitting that across five tables would make the commonest query a
-- five-way union.

CREATE TABLE IF NOT EXISTS rum_events
(
    tenant_id     UUID,
    app_id        UUID,
    ts            DateTime64(3) CODEC(Delta, ZSTD(1)),
    session_id    String,
    view_id       String DEFAULT '',
    event_type    LowCardinality(String),
    url           String CODEC(ZSTD(1)),
    -- The route, not the URL: `/orders/4821` and `/orders/9134` are one page
    -- and grouping by URL gives a table with one row per visitor.
    route         LowCardinality(String) DEFAULT '',
    vital_name    LowCardinality(String) DEFAULT '',
    vital_value   Float64 DEFAULT 0,
    -- Google's own thresholds, carried rather than recomputed at read: they
    -- change between web-vitals releases, and a chart whose "good" moved under
    -- it is a chart nobody can compare to last month.
    vital_rating  LowCardinality(String) DEFAULT '',
    browser       LowCardinality(String) DEFAULT '',
    os            LowCardinality(String) DEFAULT '',
    device        LowCardinality(String) DEFAULT '',
    -- The country only. The address it came from is never stored: a RUM table
    -- is the one place in this product that holds something about a person who
    -- never agreed to anything, and an IP is the identifier that makes it
    -- personal.
    country       LowCardinality(String) DEFAULT '',
    trace_id      String DEFAULT '',
    error_type    LowCardinality(String) DEFAULT '',
    error_message String DEFAULT '' CODEC(ZSTD(3)),
    error_stack   String DEFAULT '' CODEC(ZSTD(3)),
    -- A salted digest of whatever the application called the user, never the
    -- value. Enough to say "one person hit this forty times", not enough to
    -- say who.
    user_hash     String DEFAULT '',
    attributes    Map(LowCardinality(String), String),
    retention_at  DateTime,

    INDEX idx_session session_id TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_trace   trace_id   TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY toDate(ts)
ORDER BY (tenant_id, app_id, ts)
TTL retention_at DELETE;

-- One row per session, merged from its events. The list screen reads this;
-- reading the events would be a scan of every page view ever recorded.
CREATE TABLE IF NOT EXISTS rum_sessions_agg
(
    tenant_id  UUID,
    app_id     UUID,
    session_id String,
    day        Date,
    start      SimpleAggregateFunction(min, DateTime64(3)),
    finish     SimpleAggregateFunction(max, DateTime64(3)),
    views      AggregateFunction(uniq, String),
    errors     AggregateFunction(countIf, Bool),
    lcp        AggregateFunction(quantiles(0.75), Float64),
    country    SimpleAggregateFunction(any, LowCardinality(String)),
    device     SimpleAggregateFunction(any, LowCardinality(String)),
    browser    SimpleAggregateFunction(any, LowCardinality(String)),
    entry_url  SimpleAggregateFunction(any, String)
)
ENGINE = AggregatingMergeTree
PARTITION BY day
ORDER BY (tenant_id, app_id, day, session_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS rum_sessions_mv TO rum_sessions_agg AS
SELECT
    e.tenant_id AS tenant_id,
    e.app_id AS app_id,
    e.session_id AS session_id,
    toDate(e.ts) AS day,
    min(e.ts) AS start,
    max(e.ts) AS finish,
    uniqState(e.view_id) AS views,
    countIfState(e.event_type = 'error') AS errors,
    quantilesState(0.75)(if(e.vital_name = 'LCP', e.vital_value, nan)) AS lcp,
    any(e.country) AS country,
    any(e.device) AS device,
    any(e.browser) AS browser,
    any(e.url) AS entry_url
FROM rum_events AS e
GROUP BY tenant_id, app_id, session_id, day;

CREATE VIEW IF NOT EXISTS rum_events_t AS
SELECT * FROM rum_events WHERE tenant_id = {tenant:UUID};

CREATE VIEW IF NOT EXISTS rum_sessions_t AS
SELECT
    s.tenant_id AS tenant_id,
    s.app_id AS app_id,
    s.session_id AS session_id,
    min(s.start) AS started,
    max(s.finish) AS ended,
    uniqMerge(s.views) AS views,
    countIfMerge(s.errors) AS errors,
    quantilesMerge(0.75)(s.lcp)[1] AS lcp_p75,
    any(s.country) AS country,
    any(s.device) AS device,
    any(s.browser) AS browser,
    any(s.entry_url) AS entry_url
FROM rum_sessions_agg AS s
WHERE s.tenant_id = {tenant:UUID}
GROUP BY tenant_id, app_id, session_id;
