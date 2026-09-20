-- T4 — session replay (spec 15 §15.5).
--
-- What the person actually saw, when the numbers do not settle an argument.
-- A p75 LCP of 3.1 s says the page was slow; a replay says the spinner ran
-- twice because the retry fired before the first response landed. Only one of
-- those ends the discussion.
--
-- The recording is a list of rrweb events: one full DOM snapshot, then
-- mutations. They arrive in chunks because a session has no end a browser can
-- predict — the visitor closes the tab — so a recording that is only written
-- when the session finishes is a recording that is usually never written.
--
-- WHY THE PAYLOAD LIVES HERE AND NOT IN OBJECT STORAGE
--
-- Object storage is the answer at scale and it is not the answer yet, for one
-- reason: retention. Every other telemetry table expires by `retention_at` and
-- a ClickHouse TTL, and that is the whole mechanism — no sweeper, nothing to
-- forget to run. Chunks in a bucket would expire from the index and stay in
-- the bucket, which is the failure mode where somebody's session recordings
-- outlive the retention their workspace was promised. That is the wrong thing
-- to get wrong, so the payload expires with its index row.
--
-- The payload is stored as the JSON the browser sent, not as the gzip it sent
-- it in: ZSTD on the column compresses the text far better than it can
-- recompress an already-deflated blob, and it decompresses on read for free.
CREATE TABLE IF NOT EXISTS rum_replay_chunks
(
    tenant_id    UUID,
    app_id       UUID,
    session_id   String,
    -- The browser's own counter for this session, starting at 0. Ordering by
    -- arrival would put a retried chunk after one recorded later, and a replay
    -- whose mutations are applied out of order does not merely look wrong, it
    -- throws in the player.
    seq          UInt32,
    first_ts     DateTime64(3) CODEC(Delta, ZSTD(1)),
    last_ts      DateTime64(3) CODEC(Delta, ZSTD(1)),
    events       UInt32,
    -- Whether this chunk opens with a full snapshot. The player needs one to
    -- start from, and a session can contain several — every page navigation
    -- takes a new one.
    has_snapshot Bool DEFAULT false,
    payload      String CODEC(ZSTD(3)),
    retention_at DateTime
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(first_ts)
-- Ordered by the key the player reads with: every chunk of one session, in
-- order, is then one contiguous range.
ORDER BY (tenant_id, app_id, session_id, seq)
TTL retention_at DELETE;

CREATE VIEW IF NOT EXISTS rum_replay_chunks_t AS
SELECT * FROM rum_replay_chunks WHERE tenant_id = {tenant:UUID};

-- The index the session list reads: one row per recorded session, without
-- touching a payload. Reading `rum_replay_chunks` to answer "does this session
-- have a replay" would drag every megabyte of DOM through the query.
CREATE VIEW IF NOT EXISTS rum_replays_t AS
SELECT
    app_id,
    session_id,
    min(first_ts)   AS start,
    max(last_ts)    AS finish,
    sum(events)     AS events,
    count()         AS chunks,
    sum(length(payload)) AS bytes
  FROM rum_replay_chunks
 WHERE tenant_id = {tenant:UUID}
 GROUP BY app_id, session_id;
