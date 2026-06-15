-- ============================================================
-- SaveQuest Migration 017 — Daily notification cron fix
-- ============================================================
-- Vercel's Hobby plan allows cron jobs to run at most ONCE PER DAY
-- (vercel.json already schedules /api/cron/notifications for
-- "0 8 * * *" — once daily at 08:00 UTC).
--
-- The previous scheduler gating (`localHour !== notificationHour
-- => skip`) assumed the cron could fire every hour and would only
-- "catch" a user during the exact hour matching their
-- last_notification_hour. With a single daily invocation at a
-- fixed UTC time, only users whose local time happens to equal
-- their preferred hour AT THAT EXACT UTC MOMENT would ever be
-- processed — everyone else would never receive a notification,
-- on any day, ever.
--
-- Fix: track the last UTC date a notification was sent per user.
-- On each (single, daily) cron run, send to any user who:
--   - has notifications enabled, AND
--   - hasn't been sent a notification yet today (their local date), AND
--   - whose local time is now >= their preferred hour (so we don't
--     wake someone at 3am their time on a day the cron happens to
--     land early for their timezone)
--
-- This guarantees at most one notification per user per day, sent
-- as close to their preferred hour as the single daily cron
-- invocation allows.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_notification_sent_date DATE;

COMMENT ON COLUMN public.profiles.last_notification_sent_date IS
  'UTC date (or local date in push_subscriptions.timezone) the user last received a scheduled push notification — prevents double-sends across multiple cron invocations on the same day.';

-- ── Known follow-up (not addressed in this migration) ───────────
-- record_app_open() (migration 014) auto-adjusts last_notification_hour
-- toward the user's typical app-open time using a hardcoded
-- 'Africa/Johannesburg' timezone, via an exponential moving average:
--   last_notification_hour = ROUND(existing * 0.8 + current_hour * 0.2)
-- This runs on every dashboard visit and will slowly drift a user's
-- EXPLICITLY CHOSEN reminder hour (set via NotificationSettings.tsx)
-- toward their app-open time in the wrong timezone for non-SA users.
-- Recommended fix (separate migration): only auto-set
-- last_notification_hour the FIRST time (when NULL), and never
-- overwrite a value the user has explicitly saved — e.g. add a
-- `notification_hour_is_default BOOLEAN` flag, or simply remove the
-- EMA branch entirely now that NotificationSettings.tsx lets users
-- set this directly.
