-- ─────────────────────────────────────────────────────────────────────────────
-- 062_notification_center_inbox.sql
-- Sprint 27 — Phase 2: Notification Center → full inbox.
-- ─────────────────────────────────────────────────────────────────────────────
-- Extends the existing notification_logs table (same approach migration
-- 038_notification_center.sql already used for read_at) rather than a
-- parallel table — this table already has everything an inbox needs
-- (user_id, notification_type, title, body, sent_at, read_at); it was
-- only missing archive/delete state and a place to persist the deep link
-- that lib/notifications.ts's sendToUser() already COMPUTES for every
-- push payload's `url` field but, until this sprint, never saved.
--
-- deep_link — nullable TEXT, not NOT NULL. Rows sent before this migration
--   have no deep_link and will fall back to a category-level page client-side
--   (see lib/notificationTaxonomy.ts) rather than /dashboard. Going forward,
--   lib/notifications.ts persists it on every send (this migration ships
--   together with that code change, not before it).
--
-- archived_at / deleted_at — same "single nullable timestamp = state" pattern
--   as read_at, not a boolean flag, so *when* something was archived/deleted
--   is preserved for free.
--
-- deleted_at IS SOFT DELETE, deliberately, not a real DELETE. The existing
--   "audit trail of what was actually sent" principle from migration
--   038_notification_center.sql applies here too — sent_at/title/body/
--   notification_type/delivered_at/clicked_at must stay reconstructable for
--   support/analytics even after a user "deletes" a notification from their
--   own inbox view. Every query this sprint's routes make filters
--   `deleted_at IS NULL` at the application layer; nothing here prevents a
--   row existing with deleted_at set, on purpose.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE notification_logs
  ADD COLUMN IF NOT EXISTS deep_link   TEXT,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at  timestamptz;

CREATE INDEX IF NOT EXISTS notification_logs_archived_at_idx ON notification_logs(archived_at);
CREATE INDEX IF NOT EXISTS notification_logs_deleted_at_idx  ON notification_logs(deleted_at);

-- The existing "notification_logs_update_own_read_state" UPDATE policy
-- (migration 038) already covers archived_at/deleted_at too — Postgres RLS
-- policies scope which ROWS an UPDATE can touch (auth.uid() = user_id),
-- not which COLUMNS, same limitation that migration's own comment already
-- documents for read_at. That guarantee — only read_at/archived_at/
-- deleted_at are ever written by a user, never title/body/sent_at/type —
-- continues to be enforced by which columns the API routes actually set
-- (app/api/notifications/{mark-read,archive,delete}/route.ts), same as
-- before. No new RLS policy needed; flagging explicitly rather than
-- silently relying on it without a comment here too.

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================
-- SELECT deep_link, archived_at, deleted_at FROM notification_logs LIMIT 1;
-- SELECT indexname FROM pg_indexes WHERE tablename = 'notification_logs';
-- Expected: notification_logs_archived_at_idx and
-- notification_logs_deleted_at_idx both present.
-- ============================================================
