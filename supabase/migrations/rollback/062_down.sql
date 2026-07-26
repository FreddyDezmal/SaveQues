-- ─────────────────────────────────────────────────────────────────────────────
-- 062_down.sql
-- Rollback for 062_notification_center_inbox.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Drops the three added columns and their indexes. Safe with respect to
-- the audit-trail principle in the up-migration: this only removes the
-- archive/delete/deep-link STATE, not any row — no notification_logs rows
-- are deleted by this rollback, "soft deleted" or otherwise.
--
-- WARNING: after this runs, app/api/notifications/{archive,delete}/route.ts
-- and lib/notifications.ts's deep_link persistence will fail (missing
-- column) until those code changes are rolled back too. Roll back code
-- before/with schema, not schema first against a still-deployed app.
-- ─────────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS notification_logs_archived_at_idx;
DROP INDEX IF EXISTS notification_logs_deleted_at_idx;

ALTER TABLE notification_logs
  DROP COLUMN IF EXISTS deep_link,
  DROP COLUMN IF EXISTS archived_at,
  DROP COLUMN IF EXISTS deleted_at;
