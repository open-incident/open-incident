-- The hourly exception rows, per workspace (spec 15 §15.8).
--
-- `exception_groups_t` already merges every hour into one row per fingerprint,
-- which is what the Exceptions screen reads. Deciding whether a group is
-- suddenly firing far more often than usual needs the opposite: the hours kept
-- apart, so one of them can be compared to the median of the others.

CREATE VIEW IF NOT EXISTS exception_groups_1h_t AS
SELECT * FROM exception_groups_1h WHERE tenant_id = {tenant:UUID};
