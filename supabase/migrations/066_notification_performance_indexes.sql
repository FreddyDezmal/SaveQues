-- ─────────────────────────────────────────────────────────────────────────────
-- Sprint 27, Phase 13 — Performance
--
-- notification_logs already has single-column indexes on user_id,
-- sent_at, notification_type, read_at, archived_at, deleted_at,
-- dismissed_at, converted_at (014, 038, 062, 20260613, 20260725) — this
-- migration adds two COMPOSITE indexes targeting the two actual query
-- shapes hit hardest in practice, which single-column indexes can only
-- partially serve (Postgres can use one column as an index scan and
-- must then filter/sort the rest in memory):
--
-- 1. notification_logs_dedup_idx — the exact shape
--    getRecentlyNotifiedUserIds() (lib/notifications.ts, Phase 8) uses,
--    now called from SIX places: three of the schedulers' own dedup
--    checks (weekly/monthly/group-weekly summaries) plus
--    goal_almost_complete's and group_quest_ending's dedup, all doing
--    `.eq(notification_type, X).in(user_id, [...]).gte(sent_at, Y)`.
--    Leading with notification_type (typically ONE value per call) then
--    sent_at (a range) lets Postgres do a tight index range scan before
--    ever touching the user_id IN-list, instead of scanning by user_id
--    or sent_at alone and filtering the rest row-by-row.
--
-- 2. notification_logs_inbox_idx — the Notification Center's own list
--    query (app/api/notifications/list/route.ts): `.eq(user_id, X)
--    .is(deleted_at, null).order(sent_at desc)`. This is USER-FACING
--    latency (every time someone opens their notification bell), not
--    just background cron efficiency — arguably the single most
--    latency-sensitive query in this whole system. A PARTIAL index
--    (WHERE deleted_at IS NULL) is used deliberately: soft-deleted rows
--    are the minority and never appear in any inbox view (see that
--    route's own comment), so excluding them from the index entirely
--    keeps it smaller and faster than indexing every row unconditionally.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS notification_logs_dedup_idx
  ON notification_logs (notification_type, sent_at, user_id);

CREATE INDEX IF NOT EXISTS notification_logs_inbox_idx
  ON notification_logs (user_id, sent_at DESC)
  WHERE deleted_at IS NULL;

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================
-- EXPLAIN ANALYZE SELECT user_id FROM notification_logs
--   WHERE notification_type = 'goal_almost_complete'
--   AND user_id IN ('...') AND sent_at >= now() - interval '14 days';
-- Expected: Index Scan using notification_logs_dedup_idx, not a
-- Seq Scan or an index scan on a single-column index followed by a
-- large Filter step.
--
-- EXPLAIN ANALYZE SELECT id, notification_type, title, body, sent_at
--   FROM notification_logs
--   WHERE user_id = '...' AND deleted_at IS NULL
--   ORDER BY sent_at DESC LIMIT 30;
-- Expected: Index Scan using notification_logs_inbox_idx, no sort step
-- (the index is already in sent_at DESC order).
-- ============================================================
