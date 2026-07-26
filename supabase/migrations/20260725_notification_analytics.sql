-- ─────────────────────────────────────────────────────────────────────────────
-- Sprint 27, Phase 11 — Notification Analytics
--
-- Extends notification_logs again (same table three migrations have now
-- extended: 038 added read_at, 062 added deep_link/archived_at/deleted_at,
-- this one adds dismissed_at/converted_at) rather than a parallel
-- analytics table — every event this phase tracks is a fact about one
-- specific notification send, same "single nullable timestamp = state,
-- and WHEN it happened is preserved for free" pattern those migrations
-- already established.
--
-- The brief asks to track six things: Delivered, Opened, Dismissed,
-- Clicked, Converted, Ignored. Only two of those need a new column here:
--   • dismissed_at  — NEW. The service worker already distinguished a
--     "dismiss" action from a "click" action but never recorded it
--     (see public/sw.js's history — the dismiss action handler called
--     event.notification.close() and returned, nothing else). Real gap,
--     fixed this phase alongside this column.
--   • converted_at  — NEW. Did the notification lead to the actual
--     underlying action (e.g. a deposit after a savings reminder), not
--     just a tap. Nothing in this codebase tracked this before.
--
-- The other four map onto EXISTING columns/logic, not new state:
--   • Delivered → delivered_at (Sprint 13/20260613_notifications.sql)
--   • Clicked   → clicked_at (same)
--   • Opened    → read_at (Sprint 15/038) — the in-app inbox's read
--     state IS "the user opened/viewed this notification," reused
--     rather than duplicated under a second name.
--   • Ignored   → NOT a tracked event at all, a COMPUTED reporting
--     category (delivered but never clicked/read/dismissed) — see
--     lib/notificationAnalytics.ts. No column, nothing to migrate.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE notification_logs
  ADD COLUMN IF NOT EXISTS dismissed_at timestamptz,
  ADD COLUMN IF NOT EXISTS converted_at timestamptz;

CREATE INDEX IF NOT EXISTS notification_logs_dismissed_at_idx ON notification_logs(dismissed_at);
CREATE INDEX IF NOT EXISTS notification_logs_converted_at_idx ON notification_logs(converted_at);

-- The existing "notification_logs_update_own_read_state" UPDATE policy
-- (migration 038) already covers these two new columns the same way it
-- already covers archived_at/deleted_at (062) — Postgres RLS scopes which
-- ROWS an UPDATE can touch (auth.uid() = user_id), not which COLUMNS.
-- dismissed_at is written by the client (via /api/notifications/track,
-- same route delivered_at/clicked_at already use) so this matters;
-- converted_at is written server-side only (service-role client, from
-- wherever a conversion is attributed — see
-- lib/notificationAttribution.ts) and never by a client request, so it
-- doesn't strictly need the client-facing RLS policy at all, but no harm
-- in it being covered by the same blanket "own rows" scope every other
-- column here already has.

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================
-- SELECT dismissed_at, converted_at FROM notification_logs LIMIT 1;
-- SELECT indexname FROM pg_indexes WHERE tablename = 'notification_logs';
-- Expected: notification_logs_dismissed_at_idx and
-- notification_logs_converted_at_idx both present.
-- ============================================================
