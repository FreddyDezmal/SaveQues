-- ─────────────────────────────────────────────────────────────────────────────
-- 065_down.sql
-- Rollback for 065_notification_analytics.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Drops the two added columns and their indexes. Same audit-trail
-- guarantee as 062's rollback: no notification_logs rows are deleted,
-- only the dismissed_at/converted_at STATE those rows carried.
--
-- WARNING: after this runs, /api/notifications/track's dismiss handling,
-- the service worker's dismiss-action recording, and
-- lib/notificationAttribution.ts's conversion writes will all fail
-- (missing column) until that code is rolled back too. This will also
-- silently degrade lib/notificationAnalytics.ts's reporting (065's whole
-- point) back to its pre-065 blind spots on Dismissed/Converted.
-- ─────────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS notification_logs_dismissed_at_idx;
DROP INDEX IF EXISTS notification_logs_converted_at_idx;

ALTER TABLE notification_logs
  DROP COLUMN IF EXISTS dismissed_at,
  DROP COLUMN IF EXISTS converted_at;
