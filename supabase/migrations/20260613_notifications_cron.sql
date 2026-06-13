-- ─────────────────────────────────────────────────────────────────────────────
-- Optional: Supabase pg_cron schedule for notification delivery
-- Run this in Supabase SQL Editor (requires pg_cron extension enabled)
--
-- Alternatively use GitHub Actions, Vercel Cron, or any HTTP cron service
-- to call GET /api/cron/notifications every hour with Authorization header.
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable pg_cron (Supabase: Database → Extensions → pg_cron)
-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule the notification job to run every hour at :00
-- (The API route itself filters by user's preferred hour + timezone)
SELECT cron.schedule(
  'savequest-notifications-hourly',
  '0 * * * *',            -- every hour on the hour
  $$
  SELECT net.http_get(
    url := 'https://AppName/api/cron/notifications',
    headers := '{"Authorization": "Bearer YOUR_CRON_SECRET"}'::jsonb
  );
  $$
);

-- To view scheduled jobs:
-- SELECT * FROM cron.job;

-- To remove:
-- SELECT cron.unschedule('savequest-notifications-hourly');
