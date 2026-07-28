-- ─────────────────────────────────────────────────────────────────────────────
-- 066_down.sql
-- Rollback for 066_notification_performance_indexes.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Drops the two composite indexes. Purely a performance rollback — no
-- columns, no data, and no query in the app will fail after this runs;
-- the dedup and inbox-list queries just fall back to whatever
-- single-column indexes/seq scans they used before 066, i.e. slower, not
-- broken.
-- ─────────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS notification_logs_dedup_idx;
DROP INDEX IF EXISTS notification_logs_inbox_idx;
