-- ─────────────────────────────────────────────────────────────────────────────
-- Sprint 16 — Notification Preferences
--
-- A new table, not new columns on `profiles` — profiles already carries
-- notification_hour/notifications_enabled (the global on/off + timing), and
-- this is a distinct, growable set of per-category booleans that doesn't
-- belong bolted onto the profile row.
--
-- HONESTY NOTE (see lib/notifications.ts for where this is enforced):
-- Only two of these six categories currently gate a real send path today:
--   • streak_reminders  → gates sendStreakAtRisk()
--   • goal_reminders    → gates sendDailyQuestReminder(), sendWeeklyQuestExpiry(),
--                          sendSeasonalExpiry() (the closest existing analogs
--                          to "goal reminders" — this app's goal progress is
--                          driven by quests, there's no separate "goal
--                          reminder" send path distinct from quest reminders)
-- The other four (achievements, weekly_summaries, milestone_celebrations,
-- product_announcements) have NO existing send path anywhere in the codebase
-- — achievement unlocks are currently an in-app-only celebration
-- (CelebrationOverlay), and weekly summaries / milestone pushes / product
-- announcements don't exist yet at all. Their toggles are still fully real
-- and persisted (so the UI and API are not fake), and will correctly gate
-- those sends once those features are built — but until then, "respecting"
-- them is trivially true because nothing sends them yet. Documented here so
-- this isn't discovered as a surprise later.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id                uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  achievements           boolean NOT NULL DEFAULT true,
  goal_reminders         boolean NOT NULL DEFAULT true,
  streak_reminders       boolean NOT NULL DEFAULT true,
  weekly_summaries       boolean NOT NULL DEFAULT true,
  milestone_celebrations boolean NOT NULL DEFAULT true,
  product_announcements  boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notification_preferences_select_own" ON notification_preferences
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "notification_preferences_insert_own" ON notification_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "notification_preferences_update_own" ON notification_preferences
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Keep updated_at accurate without relying on every call site to set it.
CREATE OR REPLACE FUNCTION set_notification_preferences_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notification_preferences_updated_at ON notification_preferences;
CREATE TRIGGER trg_notification_preferences_updated_at
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION set_notification_preferences_updated_at();
