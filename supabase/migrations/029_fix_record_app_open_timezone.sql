-- ─────────────────────────────────────────────────────────────────────────────
-- 029_fix_record_app_open_timezone.sql
-- Sprint 11 — Phase 2: Notification System Fix
-- ─────────────────────────────────────────────────────────────────────────────
--
-- BUG (found during Sprint 11 Phase 1 investigation, not in the original
-- Scaling Audit — that audit looked at cron frequency, which was already
-- correctly fixed by migration 017; this is a different, real defect found
-- while verifying that fix):
--
--   record_app_open() computes current_hour using a HARDCODED timezone:
--     current_hour INTEGER := EXTRACT(HOUR FROM NOW() AT TIME ZONE 'Africa/Johannesburg');
--
--   This function runs on EVERY dashboard load for EVERY user (called
--   fire-and-forget from app/(app)/dashboard/page.tsx) and applies an
--   exponential moving average that drifts profiles.last_notification_hour
--   — the exact value the once-daily notification scheduler uses to decide
--   when to send — toward the CURRENT HOUR IN JOHANNESBURG, regardless of
--   where the user actually is.
--
--   A user who explicitly sets "notify me at 8 PM" via NotificationSettings.tsx
--   will have that preference silently eroded toward Johannesburg time every
--   time they open the app, if they are not themselves in that timezone.
--
-- FIX
--   Read the user's ACTUAL timezone from push_subscriptions.timezone (the
--   only place a real, validated, user-specific IANA timezone is stored —
--   see app/api/notifications/subscribe/route.ts, which validates against
--   Intl.supportedValuesOf("timeZone") before storing it).
--
--   profiles.timezone was considered and explicitly REJECTED as the source:
--   it exists in the schema (added in 20260613_notifications.sql) but is
--   NEVER WRITTEN BY ANY APPLICATION CODE — confirmed by reading every
--   route in app/api during Phase 1. It always holds its DEFAULT 'UTC' and
--   using it would silently replace one wrong hardcoded value with a
--   different wrong default value, not fix the bug.
--
--   If a user has no active push_subscriptions row yet (they haven't
--   enabled notifications), there is no real timezone to drift toward —
--   the function now SKIPS the EMA update entirely in that case, rather
--   than guessing. last_notification_hour will be correctly set for the
--   first time when the user DOES subscribe (the subscribe route's own
--   logic, unchanged by this migration) or by this function once a
--   subscription exists.
--
-- SAFETY
--   This function is SECURITY DEFINER and already restricted to operating
--   only on auth.uid()'s own row (the C1 privilege-escalation guard from
--   migration 018 is preserved unchanged below). Reading push_subscriptions
--   for that same user_id inside a SECURITY DEFINER function is safe and
--   consistent with the function's existing trust boundary — it is not a
--   new privilege, it's the same function reading one more of the calling
--   user's own rows.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_app_open(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  user_timezone TEXT;
  current_hour  INTEGER;
  existing_hour INTEGER;
BEGIN
  -- C1 guard (unchanged from migration 018) — a user may only record
  -- their own app-open event, never another user's.
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Look up the user's real timezone from their most recently updated
  -- active push subscription. If they have multiple devices in different
  -- timezones, the most recently updated one is the best available signal
  -- of "where they are now" — not perfect, but far better than a hardcoded
  -- constant, and consistent with how the notification scheduler itself
  -- already treats per-subscription timezone as the source of truth.
  SELECT timezone INTO user_timezone
  FROM public.push_subscriptions
  WHERE user_id = p_user_id AND is_active = true
  ORDER BY updated_at DESC
  LIMIT 1;

  -- No active subscription yet — nothing real to drift toward. Skip the
  -- EMA update entirely rather than guessing with a default. This is a
  -- deliberate no-op, not an error: most users will not have subscribed
  -- to push notifications on their very first few app opens.
  IF user_timezone IS NULL THEN
    RETURN;
  END IF;

  -- Defensive: if an invalid timezone somehow made it into the column
  -- (should not happen given the subscribe route's validation, but this
  -- function must never throw and break the fire-and-forget caller),
  -- fall back to UTC rather than letting EXTRACT(... AT TIME ZONE ...)
  -- raise on an unrecognised zone name.
  BEGIN
    current_hour := EXTRACT(HOUR FROM NOW() AT TIME ZONE user_timezone);
  EXCEPTION WHEN OTHERS THEN
    current_hour := EXTRACT(HOUR FROM NOW() AT TIME ZONE 'UTC');
  END;

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

-- Permissions unchanged from migration 018 — re-stated for clarity since
-- CREATE OR REPLACE does not alter existing GRANT/REVOKE state, but this
-- makes the full permission picture visible in this migration file too.
REVOKE ALL ON FUNCTION public.record_app_open(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_app_open(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification query (run manually after migration, against a non-SA test
-- account with an active push subscription in a different timezone):
--
-- 1. Set a known last_notification_hour:
--      UPDATE profiles SET last_notification_hour = 20 WHERE id = '<test_user_id>';
-- 2. Confirm the test account's push_subscriptions.timezone is NOT
--    'Africa/Johannesburg' (e.g. 'America/Los_Angeles').
-- 3. Call: SELECT record_app_open('<test_user_id>');
-- 4. Confirm last_notification_hour moved toward the CURRENT HOUR IN
--    America/Los_Angeles, not toward the current hour in Johannesburg.
-- ─────────────────────────────────────────────────────────────────────────────