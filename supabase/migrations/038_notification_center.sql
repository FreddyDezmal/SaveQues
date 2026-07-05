-- ─────────────────────────────────────────────────────────────────────────────
-- Sprint 15 — Notification Center
-- Extends the existing notification_logs table (Sprint 13, migration
-- 20260613_notifications.sql) rather than creating a parallel table. That
-- table already has everything an in-app inbox needs (user_id,
-- notification_type, title, body, sent_at) except a read/unread state and
-- permission for users to set it.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE notification_logs
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

CREATE INDEX IF NOT EXISTS notification_logs_read_at_idx ON notification_logs(read_at);

-- The existing "notification_logs_read_own" policy only covers SELECT.
-- Users need UPDATE permission on their own rows to mark notifications
-- read, but ONLY on read_at — they must never be able to alter sent_at,
-- title, body, or notification_type (those are the audit trail of what was
-- actually sent, and must stay immutable from the client). Postgres RLS
-- policies can't restrict which *columns* an UPDATE touches on their own,
-- so that guarantee is enforced by the API route (app/api/notifications/
-- mark-read/route.ts) only ever writing `read_at`, in addition to this
-- row-level policy scoping *which rows* can be touched at all.
CREATE POLICY "notification_logs_update_own_read_state" ON notification_logs
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
