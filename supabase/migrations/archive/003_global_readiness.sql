-- ============================================================
-- SaveQuest Migration 003
-- Adds: streak pause mechanic, notification timing personalisation
-- ============================================================

-- ── STREAK PAUSE ─────────────────────────────────────────────
-- NULL = not paused. A date = paused until that date (inclusive).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS streak_paused_until DATE;

-- ── NOTIFICATION TIMING ───────────────────────────────────────
-- Stores the hour (0–23) the user most commonly opens the app.
-- Used to send the daily notification ~1hr before that time.
-- NULL = not enough data yet, fall back to 18:00 (6pm).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_notification_hour INTEGER;

-- Function: update last_notification_hour on app open
-- Call this from the dashboard load via supabase.rpc('record_app_open')
CREATE OR REPLACE FUNCTION public.record_app_open(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
  current_hour INTEGER := EXTRACT(HOUR FROM NOW() AT TIME ZONE 'Africa/Johannesburg');
  existing_hour INTEGER;
BEGIN
  SELECT last_notification_hour INTO existing_hour
  FROM public.profiles WHERE id = p_user_id;

  -- Rolling average: blend current hour with historical average
  -- Weight: 80% existing, 20% new observation (stabilises quickly)
  IF existing_hour IS NULL THEN
    UPDATE public.profiles
    SET last_notification_hour = current_hour
    WHERE id = p_user_id;
  ELSE
    UPDATE public.profiles
    SET last_notification_hour = ROUND(existing_hour * 0.8 + current_hour * 0.2)
    WHERE id = p_user_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;