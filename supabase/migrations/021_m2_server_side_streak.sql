-- ============================================================
-- SaveQuest Migration 021 — M2: Server-Side Streak Calculation
-- ============================================================
-- Replaces the 6-parameter update_streak() that accepted
-- caller-computed values with a zero-parameter version that
-- derives all streak state from the existing profile row.
--
-- Before:
--   update_streak(p_user_id, p_today, p_new_streak, p_longest,
--                 p_shields, p_shields_used)
--   → caller computes everything; DB blindly writes supplied values
--
-- After:
--   update_streak(p_user_id UUID DEFAULT auth.uid())
--   → DB reads last_active_date, streak_days, streak_shields,
--     streak_paused_until; computes all transitions; writes result;
--     returns JSONB result for the caller to read back
--
-- Streak rules (mirror of lib/streaks.ts evaluateStreak()):
--   diff = 0    → already updated today, no-op
--   diff = 1    → continuation: streak_days + 1
--   diff = 2    → grace day: if shields > 0 → streak + 1, shield - 1
--   diff > 2    → broken: streak_days = 1, shields unchanged
--   paused      → no-op (streak_paused_until >= today)
--   null date   → first ever active day: streak = 1
--
-- Milestone XP awards:
--   Streak milestones that grant XP are handled in the dashboard
--   after reading the returned new_streak value — the function
--   does not call award_xp() directly to keep concerns separated
--   and avoid circular SECURITY DEFINER calls.
-- ============================================================


-- ── Drop the old 6-parameter signature ───────────────────────
-- Migration 018 already dropped the original 014 signature.
-- This drops the 018 signature before recreating.
DROP FUNCTION IF EXISTS public.update_streak(UUID, DATE, INTEGER, INTEGER, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.update_streak(UUID);


-- ── New zero-computation signature ───────────────────────────
CREATE OR REPLACE FUNCTION public.update_streak(
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_profile        RECORD;
  v_today          DATE    := CURRENT_DATE;
  v_diff           INTEGER;
  v_new_streak     INTEGER;
  v_longest        INTEGER;
  v_new_shields    INTEGER;
  v_new_used       INTEGER;
  v_grace_used     BOOLEAN := FALSE;
  v_broken         BOOLEAN := FALSE;
  v_already_today  BOOLEAN := FALSE;
BEGIN
  -- C1 guard: caller must own the account
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Lock the profile row for the duration of this transaction
  -- to prevent double-updates from concurrent requests (e.g.
  -- two browser tabs opening simultaneously).
  SELECT
    streak_days,
    longest_streak,
    last_active_date,
    streak_shields,
    total_shields_used,
    streak_paused_until
  INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = 'no_data_found';
  END IF;

  -- ── Already updated today ─────────────────────────────────
  IF v_profile.last_active_date = v_today THEN
    RETURN jsonb_build_object(
      'updated',     false,
      'reason',      'already_updated_today',
      'streak_days', v_profile.streak_days,
      'grace_used',  false,
      'broken',      false,
      'paused',      false
    );
  END IF;

  -- ── Streak is paused ─────────────────────────────────────
  IF v_profile.streak_paused_until IS NOT NULL
     AND v_profile.streak_paused_until >= v_today THEN
    -- Still update last_active_date so we know they opened the app,
    -- but do not change streak_days or shields.
    UPDATE public.profiles
    SET last_active_date = v_today
    WHERE id = p_user_id;

    RETURN jsonb_build_object(
      'updated',     true,
      'reason',      'paused',
      'streak_days', v_profile.streak_days,
      'grace_used',  false,
      'broken',      false,
      'paused',      true
    );
  END IF;

  -- ── Compute day difference ────────────────────────────────
  IF v_profile.last_active_date IS NULL THEN
    v_diff := 999;   -- first ever open → treated as "started fresh"
  ELSE
    v_diff := v_today - v_profile.last_active_date;
  END IF;

  -- ── Apply streak rules ────────────────────────────────────
  v_new_shields := v_profile.streak_shields;
  v_new_used    := v_profile.total_shields_used;

  IF v_diff = 0 THEN
    -- Shouldn't reach here (caught above), but be defensive
    v_new_streak := v_profile.streak_days;
    v_already_today := TRUE;

  ELSIF v_diff = 1 THEN
    -- Perfect continuation
    v_new_streak := v_profile.streak_days + 1;

  ELSIF v_diff = 2 AND v_profile.streak_shields > 0 THEN
    -- Grace day absorbs the missed day
    v_new_streak  := v_profile.streak_days + 1;
    v_new_shields := v_profile.streak_shields - 1;
    v_new_used    := v_profile.total_shields_used + 1;
    v_grace_used  := TRUE;

  ELSIF v_profile.last_active_date IS NULL THEN
    -- First ever active day
    v_new_streak := 1;

  ELSE
    -- Streak broken
    v_new_streak := 1;
    v_broken     := TRUE;
  END IF;

  -- Longest streak is a high-water mark — never decreases
  v_longest := GREATEST(v_new_streak, v_profile.longest_streak);

  -- ── Persist ──────────────────────────────────────────────
  UPDATE public.profiles
  SET last_active_date   = v_today,
      streak_days        = v_new_streak,
      longest_streak     = v_longest,
      streak_shields     = v_new_shields,
      total_shields_used = v_new_used
  WHERE id = p_user_id;

  -- ── Return result for dashboard to act on ────────────────
  -- The dashboard reads these values to:
  --   a) show the correct streak_days immediately (no re-fetch needed)
  --   b) determine if a milestone was hit (for achievement awarding)
  --   c) display "grace day used" or "streak broken" UI messages
  RETURN jsonb_build_object(
    'updated',     true,
    'reason',      CASE
                     WHEN v_broken     THEN 'broken'
                     WHEN v_grace_used THEN 'grace_day'
                     WHEN v_diff = 1   THEN 'continued'
                     ELSE                   'started'
                   END,
    'streak_days', v_new_streak,
    'longest',     v_longest,
    'shields',     v_new_shields,
    'grace_used',  v_grace_used,
    'broken',      v_broken,
    'paused',      false
  );
END;
$$;

-- Authenticated users call this for their own streak only (DEFAULT auth.uid()).
REVOKE ALL ON FUNCTION public.update_streak(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_streak(UUID) TO authenticated;


-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================
-- After deploying, confirm the old signature is gone and the
-- new one is the only update_streak registered:
--
-- SELECT routine_name, specific_name,
--        string_agg(parameter_name || ' ' || data_type, ', ' ORDER BY ordinal_position) AS params
-- FROM information_schema.routines r
-- JOIN information_schema.parameters p USING (specific_name)
-- WHERE routine_schema = 'public' AND routine_name = 'update_streak'
-- GROUP BY routine_name, specific_name;
--
-- Expected: exactly one row, with params = "p_user_id uuid"
-- ============================================================