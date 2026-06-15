-- ============================================================
-- SaveQuest Migration 015 — Day Momentum Fix
-- ============================================================
-- Root cause: activity_log (the source of truth for the Day
-- Momentum heatmap on the Dashboard) was only ever written by
-- award_xp(), which is skipped for actions that award zero XP
-- (withdrawals / goal purchases) and is never called for the
-- implicit "daily check-in" (streak update on dashboard load).
--
-- This migration:
--   1. Adds log_activity_event() — a generalised, idempotent
--      activity recorder that can record an "active day" with
--      zero XP (withdrawals, check-ins, etc.) and accepts an
--      explicit p_date so the app can pass a timezone-safe
--      UTC date string instead of relying on the database
--      session's CURRENT_DATE.
--   2. Adds p_date parameters (defaulting to CURRENT_DATE for
--      backwards compatibility) to award_xp() and log_activity()
--      so every activity_log write uses the same date the app
--      computed for "today".
--   3. Adds record_checkin() — idempotent daily check-in that
--      both logs activity AND awards DAILY_CHECKIN XP once/day.
-- ============================================================


-- ── log_activity_event ────────────────────────────────────────
-- Generalised activity recorder. Safe to call multiple times per
-- day (idempotent upsert, additive deltas). Used for activity
-- that doesn't necessarily come with an XP award (e.g. withdrawals,
-- daily check-ins where XP is awarded separately).
CREATE OR REPLACE FUNCTION public.log_activity_event(
  p_user_id UUID,
  p_date    DATE DEFAULT CURRENT_DATE,
  p_xp      INTEGER DEFAULT 0,
  p_actions INTEGER DEFAULT 1
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_xp < 0 OR p_actions < 0 THEN
    RAISE EXCEPTION 'p_xp and p_actions must be non-negative';
  END IF;

  INSERT INTO public.activity_log (user_id, activity_date, xp_earned, actions_count)
  VALUES (p_user_id, p_date, p_xp, p_actions)
  ON CONFLICT (user_id, activity_date)
  DO UPDATE SET
    xp_earned     = activity_log.xp_earned     + p_xp,
    actions_count = activity_log.actions_count + p_actions;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_activity_event(UUID, DATE, INTEGER, INTEGER) TO authenticated;


-- ── log_activity (updated) ─────────────────────────────────────
-- Backwards-compatible: now accepts an explicit date.
--
-- BUGFIX: migration 014 defined log_activity(UUID, INTEGER) — a
-- 2-argument function. Adding a 3rd parameter WITH A DEFAULT via
-- CREATE OR REPLACE does not replace that signature; it creates a
-- second overload. Any 2-arg call would then be AMBIGUOUS between
-- the old 2-arg version and the new 3-arg version (whose p_date
-- defaults), causing Postgres error 42725 "function is not unique"
-- (this is what broke /api/quest/daily/complete via
-- complete_daily_quest -> award_xp). Drop the old overload first so
-- only one log_activity exists.
DROP FUNCTION IF EXISTS public.log_activity(UUID, INTEGER);

CREATE OR REPLACE FUNCTION public.log_activity(
  p_user_id UUID, p_xp INTEGER, p_date DATE DEFAULT CURRENT_DATE
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.log_activity_event(p_user_id, p_date, p_xp, 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_activity(UUID, INTEGER, DATE) TO authenticated;


-- ── award_xp (updated) ───────────────────────────────────────────
-- Adds an optional p_date parameter (default CURRENT_DATE, so
-- existing callers are unaffected) used for the activity_log
-- write, so the app can supply a timezone-consistent "today".
--
-- BUGFIX: same overload-ambiguity issue as log_activity above.
-- Migration 014 defined award_xp(UUID, TEXT, TEXT, INTEGER) — a
-- 4-argument function, called with exactly 4 args by
-- complete_daily_quest, complete_weekly_quest, complete_chain_step,
-- complete_event, and award_achievement. Adding a 5th parameter
-- WITH A DEFAULT creates a second overload, making every existing
-- 4-arg call ambiguous (42725). Drop the old 4-arg overload first.
DROP FUNCTION IF EXISTS public.award_xp(UUID, TEXT, TEXT, INTEGER);

CREATE OR REPLACE FUNCTION public.award_xp(
  p_user_id UUID, p_source_type TEXT, p_source_id TEXT, p_xp INTEGER,
  p_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new_total INTEGER;
  v_current   INTEGER;
BEGIN
  IF p_xp < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'xp must be non-negative');
  END IF;

  INSERT INTO public.xp_awards (user_id, source_type, source_id, xp_awarded)
  VALUES (p_user_id, p_source_type, p_source_id, p_xp)
  ON CONFLICT (user_id, source_type, source_id) DO NOTHING;

  IF NOT FOUND THEN
    SELECT xp_total INTO v_current FROM public.profiles WHERE id = p_user_id;
    RETURN jsonb_build_object('success', true, 'xp_awarded', 0,
      'new_total', COALESCE(v_current, 0), 'reason', 'already_awarded');
  END IF;

  UPDATE public.profiles SET xp_total = xp_total + p_xp
  WHERE id = p_user_id RETURNING xp_total INTO v_new_total;

  IF NOT FOUND THEN
    DELETE FROM public.xp_awards
    WHERE user_id = p_user_id AND source_type = p_source_type AND source_id = p_source_id;
    RETURN jsonb_build_object('success', false, 'error', 'profile not found');
  END IF;

  -- Always record activity for the day, even when p_xp = 0
  -- (e.g. admin_grant of 0, or future zero-XP source types).
  PERFORM public.log_activity_event(p_user_id, p_date, p_xp, 1);

  RETURN jsonb_build_object('success', true, 'xp_awarded', p_xp, 'new_total', v_new_total);
END;
$$;

GRANT EXECUTE ON FUNCTION public.award_xp(UUID, TEXT, TEXT, INTEGER, DATE) TO authenticated;


-- ── xp_awards: allow 'daily_checkin' as a distinct source_type ──
-- Postgres CHECK constraints can't be altered in place; drop and
-- recreate with the additional allowed value.
ALTER TABLE public.xp_awards DROP CONSTRAINT IF EXISTS xp_awards_source_type_check;
ALTER TABLE public.xp_awards ADD CONSTRAINT xp_awards_source_type_check
  CHECK (source_type IN (
    'daily_quest','weekly_quest','challenge','chain_step',
    'chain_complete','log_saving','goal_complete',
    'event_complete','achievement','admin_grant','daily_checkin'
  ));


-- ── record_checkin ───────────────────────────────────────────
-- Idempotent daily check-in: records an active day AND awards
-- DAILY_CHECKIN XP exactly once per calendar day (source_id =
-- the date itself, so award_xp's UNIQUE constraint on
-- (user_id, source_type, source_id) makes repeat calls no-ops).
CREATE OR REPLACE FUNCTION public.record_checkin(
  p_user_id UUID, p_date DATE DEFAULT CURRENT_DATE, p_xp INTEGER DEFAULT 0
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result JSONB;
BEGIN
  IF p_xp > 0 THEN
    SELECT public.award_xp(p_user_id, 'daily_checkin', p_date::TEXT, p_xp, p_date)
    INTO v_result;

    -- award_xp already records activity when xp_awarded > 0.
    IF (v_result->>'xp_awarded')::INTEGER > 0 THEN
      RETURN v_result;
    END IF;
  END IF;

  -- No XP to award (already checked in today, or p_xp = 0) —
  -- still record the active day so momentum reflects the visit.
  PERFORM public.log_activity_event(p_user_id, p_date, 0, 1);

  RETURN jsonb_build_object('success', true, 'xp_awarded', 0, 'reason', 'already_awarded');
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_checkin(UUID, DATE, INTEGER) TO authenticated;
