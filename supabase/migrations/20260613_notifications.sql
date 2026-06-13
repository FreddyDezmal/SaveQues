-- ─────────────────────────────────────────────────────────────────────────────
-- SaveQuest Notification System Migration
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Push subscriptions per user/device
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  endpoint        text NOT NULL,
  p256dh          text NOT NULL,
  auth            text NOT NULL,
  user_agent      text,
  timezone        text NOT NULL DEFAULT 'UTC',
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS push_subscriptions_active_idx  ON push_subscriptions(is_active) WHERE is_active = true;

-- 2. Notification log (sent / delivered / clicked tracking)
CREATE TABLE IF NOT EXISTS notification_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES push_subscriptions(id) ON DELETE SET NULL,
  notification_type text NOT NULL,   -- streak_at_risk | daily_quest | weekly_expiry | seasonal_expiry | inactive
  title           text NOT NULL,
  body            text NOT NULL,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz,
  clicked_at      timestamptz,
  error           text
);

CREATE INDEX IF NOT EXISTS notification_logs_user_id_idx  ON notification_logs(user_id);
CREATE INDEX IF NOT EXISTS notification_logs_sent_at_idx  ON notification_logs(sent_at);
CREATE INDEX IF NOT EXISTS notification_logs_type_idx     ON notification_logs(notification_type);

-- 3. Add timezone + notification preference to profiles (if not already present)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS timezone           text DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS notifications_enabled boolean DEFAULT false;

-- 4. notification_hour already exists per the types.ts (last_notification_hour)
--    rename alias so we can query it cleanly (non-breaking)
COMMENT ON COLUMN profiles.last_notification_hour IS 'Hour (0-23, local time) to send daily reminder';

-- 5. RLS policies
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_logs   ENABLE ROW LEVEL SECURITY;

-- Users can read/write their own subscriptions
CREATE POLICY "push_subscriptions_own" ON push_subscriptions
  FOR ALL USING (auth.uid() = user_id);

-- Users can read their own notification logs
CREATE POLICY "notification_logs_read_own" ON notification_logs
  FOR SELECT USING (auth.uid() = user_id);

-- Service role can do everything (used by cron job)
-- No policy needed — service role bypasses RLS
