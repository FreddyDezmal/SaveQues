-- ─────────────────────────────────────────────────────────────────────────────
-- 029_down.sql
-- Rollback for 029_fix_record_app_open_timezone.sql
-- ─────────────────────────────────────────────────────────────────────────────
--
-- DATA LOSS: None directly — this restores the PREVIOUS function body
--   (hardcoded 'Africa/Johannesburg'), it does not delete data. However,
--   restoring this is restoring a confirmed bug. Only run this if the
--   fixed version is somehow implicated in an incident, which is unlikely
--   given the function's behavior is a strict improvement (correct
--   per-user timezone, with a safe no-op fallback) over the original.
--
-- WARNING: After rollback, every non-Africa/Johannesburg user's
--   notification hour preference will again silently drift toward SA
--   time on every dashboard load.
--
-- SAFE TO RUN: Yes — idempotent via CREATE OR REPLACE.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_app_open(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  current_hour  INTEGER := EXTRACT(HOUR FROM NOW() AT TIME ZONE 'Africa/Johannesburg');
  existing_hour INTEGER;
BEGIN
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT last_notification_hour INTO existing_hour
  FROM public.profiles WHERE id = p_user_id;

  IF existing_hour IS NULL THEN
    UPDATE public.profiles SET last_notification_hour = current_hour WHERE id = p_user_id;
  ELSE
    UPDATE public.profiles
    SET last_notification_hour = ROUND(existing_hour * 0.8 + current_hour * 0.2)
    WHERE id = p_user_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_app_open(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_app_open(UUID) TO authenticated;