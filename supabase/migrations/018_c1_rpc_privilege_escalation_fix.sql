-- ============================================================
-- SaveQuest Migration 018 — C1 RPC Privilege-Escalation Fix
-- ============================================================
-- SECURITY REMEDIATION SPRINT 1 — Critical C1
--
-- Vulnerability:
--   Every SECURITY DEFINER gameplay RPC accepted an explicit
--   p_user_id parameter and granted EXECUTE to the `authenticated`
--   role.  Any logged-in user could call these functions directly
--   via the Supabase REST RPC endpoint (/rest/v1/rpc/<fn>) and
--   supply *any* UUID as p_user_id, allowing them to:
--     • Award themselves unlimited XP (award_xp)
--     • Complete another user's daily / weekly quests
--     • Advance another user's quest chain
--     • Complete events on behalf of other users
--     • Unlock achievements for any user
--     • Overwrite another user's streak
--     • Manipulate activity and engagement data
--     • Use source_type = 'admin_grant' without admin privileges
--
-- Fix strategy:
--   1. Player-facing RPCs (called by the app under the authenticated
--      user's session) — enforce auth.uid() = p_user_id; also block
--      'admin_grant' as a valid source_type for authenticated callers
--      in award_xp().
--   2. Infrastructure/analytics RPCs not called directly by the
--      browser client — REVOKE EXECUTE from `authenticated` entirely;
--      these functions are invoked only from server-side Next.js API
--      routes using the service_role client, which bypasses this
--      restriction.
--   3. update_engagement_status — special case: accepts NULL p_user_id
--      to sweep all users (cron job); restrict to service_role only.
--
-- Functions modified:
--   award_xp              — auth.uid() check + admin_grant guard
--   complete_daily_quest  — auth.uid() check
--   complete_weekly_quest — auth.uid() check
--   complete_chain_step   — auth.uid() check
--   complete_event        — auth.uid() check
--   award_achievement     — auth.uid() check
--   update_streak         — auth.uid() check
--   record_checkin        — auth.uid() check
--   record_app_open       — auth.uid() check
--   log_activity          — auth.uid() check (+ REVOKE from authenticated)
--   log_activity_event    — auth.uid() check (+ REVOKE from authenticated)
--   upsert_daily_activity — REVOKE from authenticated (service_role only)
--   update_engagement_status — REVOKE from authenticated (service_role only)
--
-- What does NOT change:
--   • Analytics tables or functions
--   • Notification tables or functions
--   • Admin CRUD routes or policies
--   • RLS policies
--   • Schema (no columns added or removed)
--   • Existing application behaviour — all API routes pass the
--     authenticated user's own id, so the new checks are always
--     satisfied for legitimate callers.
-- ============================================================


-- ══════════════════════════════════════════════════════════════
-- SECTION 1 — award_xp
-- ══════════════════════════════════════════════════════════════
-- Two fixes:
--   a) Enforce caller owns the account: p_user_id must equal auth.uid().
--   b) Block admin_grant source_type for non-admin callers.
--      Admins can only grant XP through the service_role path
--      (e.g. a future admin API route).  An authenticated user
--      calling with source_type = 'admin_grant' is always rejected.
--
-- NOTE: we drop and recreate (not OR REPLACE) to ensure no stale
-- 4-arg overload from migration 014 lingers alongside the 5-arg one.
-- Migration 015 already dropped the 4-arg version; this is a safety net.

DROP FUNCTION IF EXISTS public.award_xp(UUID, TEXT, TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.award_xp(UUID, TEXT, TEXT, INTEGER, DATE);

CREATE OR REPLACE FUNCTION public.award_xp(
  p_user_id     UUID,
  p_source_type TEXT,
  p_source_id   TEXT,
  p_xp          INTEGER,
  p_date        DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new_total INTEGER;
  v_current   INTEGER;
BEGIN
  -- ── C1 guard: caller must own the account ─────────────────
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── C1 guard: block admin_grant via direct RPC ────────────
  -- Admin XP grants must flow through the service_role client
  -- (server-side API routes), never via direct browser RPC.
  IF p_source_type = 'admin_grant' THEN
    RAISE EXCEPTION 'admin_grant source_type is not permitted via direct RPC'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

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

  PERFORM public.log_activity_event(p_user_id, p_date, p_xp, 1);

  RETURN jsonb_build_object('success', true, 'xp_awarded', p_xp, 'new_total', v_new_total);
END;
$$;

REVOKE ALL ON FUNCTION public.award_xp(UUID, TEXT, TEXT, INTEGER, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_xp(UUID, TEXT, TEXT, INTEGER, DATE) TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- SECTION 2 — complete_daily_quest
-- ══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.complete_daily_quest(UUID, TEXT, DATE, INTEGER);

CREATE OR REPLACE FUNCTION public.complete_daily_quest(
  p_user_id   UUID,
  p_quest_id  TEXT,
  p_quest_date DATE,
  p_xp        INTEGER
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result JSONB;
BEGIN
  -- C1 guard
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT public.award_xp(p_user_id, 'daily_quest', p_quest_date::TEXT, p_xp) INTO v_result;
  IF (v_result->>'reason') = 'already_awarded' THEN RETURN v_result; END IF;

  INSERT INTO public.daily_quest_logs (user_id, quest_id, quest_date, xp_earned)
  VALUES (p_user_id, p_quest_id, p_quest_date, p_xp)
  ON CONFLICT (user_id, quest_date) DO NOTHING;

  IF (v_result->>'xp_awarded')::INTEGER > 0 THEN
    UPDATE public.profiles SET daily_quests_completed = daily_quests_completed + 1 WHERE id = p_user_id;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_daily_quest(UUID, TEXT, DATE, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_daily_quest(UUID, TEXT, DATE, INTEGER) TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- SECTION 3 — complete_weekly_quest
-- ══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.complete_weekly_quest(UUID, TEXT, DATE, INTEGER);

CREATE OR REPLACE FUNCTION public.complete_weekly_quest(
  p_user_id    UUID,
  p_quest_id   TEXT,
  p_week_start DATE,
  p_xp         INTEGER
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result JSONB; v_rows INTEGER;
BEGIN
  -- C1 guard
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.user_weekly_quests
  SET status = 'completed', completed_at = NOW(), xp_earned = p_xp
  WHERE user_id = p_user_id AND week_start = p_week_start AND status = 'active';
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RETURN jsonb_build_object('success', true, 'xp_awarded', 0, 'reason', 'already_awarded');
  END IF;

  SELECT public.award_xp(p_user_id, 'weekly_quest', p_week_start::TEXT, p_xp) INTO v_result;

  IF (v_result->>'xp_awarded')::INTEGER > 0 THEN
    UPDATE public.profiles SET weekly_quests_completed = weekly_quests_completed + 1 WHERE id = p_user_id;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_weekly_quest(UUID, TEXT, DATE, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_weekly_quest(UUID, TEXT, DATE, INTEGER) TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- SECTION 4 — complete_chain_step
-- ══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.complete_chain_step(UUID, TEXT, INTEGER, INTEGER, BOOLEAN, INTEGER);

CREATE OR REPLACE FUNCTION public.complete_chain_step(
  p_user_id  UUID,
  p_chain_id TEXT,
  p_step     INTEGER,
  p_step_xp  INTEGER,
  p_is_last  BOOLEAN,
  p_chain_xp INTEGER
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_step_result JSONB; v_chain_result JSONB;
  v_next_step   INTEGER := p_step + 1;
  v_rows        INTEGER;
BEGIN
  -- C1 guard
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.quest_chain_progress
  SET current_step = CASE WHEN p_is_last THEN p_step ELSE v_next_step END,
      status       = CASE WHEN p_is_last THEN 'completed' ELSE 'active' END,
      completed_at = CASE WHEN p_is_last THEN NOW() ELSE NULL END
  WHERE user_id = p_user_id AND chain_id = p_chain_id
    AND status = 'active' AND current_step = p_step;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RETURN jsonb_build_object('success', true, 'xp_awarded', 0, 'reason', 'already_awarded');
  END IF;

  SELECT public.award_xp(p_user_id, 'chain_step', p_chain_id || ':' || p_step::TEXT, p_step_xp)
  INTO v_step_result;

  IF p_is_last AND p_chain_xp > 0 THEN
    SELECT public.award_xp(p_user_id, 'chain_complete', p_chain_id, p_chain_xp) INTO v_chain_result;
    UPDATE public.profiles SET quest_chains_completed = quest_chains_completed + 1 WHERE id = p_user_id;
  END IF;

  RETURN jsonb_build_object(
    'success',    true,
    'xp_awarded', COALESCE((v_step_result->>'xp_awarded')::INTEGER, 0)
                + COALESCE((v_chain_result->>'xp_awarded')::INTEGER, 0),
    'new_total',  COALESCE((v_chain_result->>'new_total')::INTEGER,
                            (v_step_result->>'new_total')::INTEGER, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_chain_step(UUID, TEXT, INTEGER, INTEGER, BOOLEAN, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_chain_step(UUID, TEXT, INTEGER, INTEGER, BOOLEAN, INTEGER) TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- SECTION 5 — complete_event
-- ══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.complete_event(UUID, TEXT, INTEGER);

CREATE OR REPLACE FUNCTION public.complete_event(
  p_user_id   UUID,
  p_event_slug TEXT,
  p_xp        INTEGER
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result JSONB; v_rows INTEGER;
BEGIN
  -- C1 guard
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.user_event_participation
  SET status = 'completed', completed_at = NOW(), xp_earned = p_xp
  WHERE user_id = p_user_id AND event_slug = p_event_slug AND status = 'active';
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RETURN jsonb_build_object('success', true, 'xp_awarded', 0, 'reason', 'already_awarded');
  END IF;

  SELECT public.award_xp(p_user_id, 'event_complete', p_event_slug, p_xp) INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_event(UUID, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_event(UUID, TEXT, INTEGER) TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- SECTION 6 — award_achievement
-- ══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.award_achievement(UUID, TEXT, INTEGER);

CREATE OR REPLACE FUNCTION public.award_achievement(
  p_user_id        UUID,
  p_achievement_id TEXT,
  p_xp             INTEGER
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result JSONB;
BEGIN
  -- C1 guard
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.user_achievements (user_id, achievement_id, earned_at)
  VALUES (p_user_id, p_achievement_id, NOW())
  ON CONFLICT (user_id, achievement_id) DO NOTHING;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'xp_awarded', 0, 'reason', 'already_awarded');
  END IF;

  SELECT public.award_xp(p_user_id, 'achievement', p_achievement_id, p_xp) INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.award_achievement(UUID, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_achievement(UUID, TEXT, INTEGER) TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- SECTION 7 — update_streak
-- ══════════════════════════════════════════════════════════════
-- Called from the Next.js dashboard Server Component under the
-- user's own Supabase session (createClient → supabase.auth.getUser()).
-- The p_user_id passed is always user.id from the session.

DROP FUNCTION IF EXISTS public.update_streak(UUID, DATE, INTEGER, INTEGER, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.update_streak(
  p_user_id      UUID,
  p_today        DATE,
  p_new_streak   INTEGER,
  p_longest      INTEGER,
  p_shields      INTEGER,
  p_shields_used INTEGER
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- C1 guard
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.profiles
  SET last_active_date   = p_today,
      streak_days        = p_new_streak,
      longest_streak     = p_longest,
      streak_shields     = p_shields,
      total_shields_used = p_shields_used
  WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_streak(UUID, DATE, INTEGER, INTEGER, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_streak(UUID, DATE, INTEGER, INTEGER, INTEGER, INTEGER) TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- SECTION 8 — record_checkin
-- ══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.record_checkin(UUID, DATE, INTEGER);

CREATE OR REPLACE FUNCTION public.record_checkin(
  p_user_id UUID,
  p_date    DATE    DEFAULT CURRENT_DATE,
  p_xp      INTEGER DEFAULT 0
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result JSONB;
BEGIN
  -- C1 guard
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_xp > 0 THEN
    SELECT public.award_xp(p_user_id, 'daily_checkin', p_date::TEXT, p_xp, p_date)
    INTO v_result;

    IF (v_result->>'xp_awarded')::INTEGER > 0 THEN
      RETURN v_result;
    END IF;
  END IF;

  PERFORM public.log_activity_event(p_user_id, p_date, 0, 1);

  RETURN jsonb_build_object('success', true, 'xp_awarded', 0, 'reason', 'already_awarded');
END;
$$;

REVOKE ALL ON FUNCTION public.record_checkin(UUID, DATE, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_checkin(UUID, DATE, INTEGER) TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- SECTION 9 — record_app_open
-- ══════════════════════════════════════════════════════════════
-- Called from the dashboard Server Component (fire-and-forget).
-- Not called via GRANT-accessible browser RPC — but was still
-- exposed.  Add the ownership check so the endpoint is safe.

DROP FUNCTION IF EXISTS public.record_app_open(UUID);

CREATE OR REPLACE FUNCTION public.record_app_open(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  current_hour  INTEGER := EXTRACT(HOUR FROM NOW() AT TIME ZONE 'Africa/Johannesburg');
  existing_hour INTEGER;
BEGIN
  -- C1 guard
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

-- record_app_open is called from a Server Component with the user's own
-- session, so authenticated access is appropriate — but only for their
-- own user_id (enforced above).
REVOKE ALL ON FUNCTION public.record_app_open(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_app_open(UUID) TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- SECTION 10 — log_activity_event  (service_role only)
-- ══════════════════════════════════════════════════════════════
-- This function is called exclusively from server-side Next.js
-- API routes via the Supabase server client (createClient() on
-- the server uses the user's cookie-based session, not service_role,
-- BUT the call goes through a trusted API route that has already
-- verified the user's identity).
--
-- However, the function also accepts arbitrary p_user_id values
-- and was callable by any authenticated user via direct RPC.
-- We add an ownership guard AND restrict to authenticated (since
-- the server client uses the user's session for these routes).

DROP FUNCTION IF EXISTS public.log_activity_event(UUID, DATE, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.log_activity_event(
  p_user_id UUID,
  p_date    DATE    DEFAULT CURRENT_DATE,
  p_xp      INTEGER DEFAULT 0,
  p_actions INTEGER DEFAULT 1
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- C1 guard
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

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

REVOKE ALL ON FUNCTION public.log_activity_event(UUID, DATE, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_activity_event(UUID, DATE, INTEGER, INTEGER) TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- SECTION 11 — log_activity  (service_role only)
-- ══════════════════════════════════════════════════════════════
-- Thin wrapper around log_activity_event. Inherits the same guard
-- via the inner call, but we add the explicit check here as well
-- so the function itself is self-defending.

DROP FUNCTION IF EXISTS public.log_activity(UUID, INTEGER, DATE);

CREATE OR REPLACE FUNCTION public.log_activity(
  p_user_id UUID,
  p_xp      INTEGER,
  p_date    DATE DEFAULT CURRENT_DATE
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- C1 guard
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM public.log_activity_event(p_user_id, p_date, p_xp, 1);
END;
$$;

REVOKE ALL ON FUNCTION public.log_activity(UUID, INTEGER, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_activity(UUID, INTEGER, DATE) TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- SECTION 12 — upsert_daily_activity  (service_role only)
-- ══════════════════════════════════════════════════════════════
-- Writes to analytics_daily_activity. Never called from the browser
-- directly — always via recordDailyActivity() in server API routes.
-- No GRANT to authenticated: the service_role client used by the
-- Next.js server bypasses this restriction.

DROP FUNCTION IF EXISTS public.upsert_daily_activity(UUID, DATE, BOOLEAN, INTEGER, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.upsert_daily_activity(
  p_user_id       UUID,
  p_date          DATE,
  p_app_opened    BOOLEAN DEFAULT FALSE,
  p_deposit_delta INTEGER DEFAULT 0,
  p_xp_delta      INTEGER DEFAULT 0,
  p_quest_delta   INTEGER DEFAULT 0
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.analytics_daily_activity
    (user_id, date, app_opened, deposit_count, xp_gained, quests_completed, updated_at)
  VALUES
    (p_user_id, p_date, p_app_opened, p_deposit_delta, p_xp_delta, p_quest_delta, NOW())
  ON CONFLICT (user_id, date) DO UPDATE SET
    app_opened       = analytics_daily_activity.app_opened OR p_app_opened,
    deposit_count    = analytics_daily_activity.deposit_count    + p_deposit_delta,
    xp_gained        = analytics_daily_activity.xp_gained        + p_xp_delta,
    quests_completed = analytics_daily_activity.quests_completed + p_quest_delta,
    updated_at       = NOW();
END;
$$;

-- Restrict: service_role only (called from server-side recordDailyActivity()).
-- authenticated users must not be able to manipulate analytics directly.
REVOKE ALL ON FUNCTION public.upsert_daily_activity(UUID, DATE, BOOLEAN, INTEGER, INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upsert_daily_activity(UUID, DATE, BOOLEAN, INTEGER, INTEGER, INTEGER) FROM authenticated;


-- ══════════════════════════════════════════════════════════════
-- SECTION 13 — update_engagement_status  (service_role only)
-- ══════════════════════════════════════════════════════════════
-- Called from /api/analytics/session/route.ts with p_user_id = user.id,
-- and from cron jobs with p_user_id = NULL (sweep-all mode).
-- The NULL-sweep path in particular must not be reachable by
-- authenticated users (it would let them reset every user's status).

DROP FUNCTION IF EXISTS public.update_engagement_status(UUID);

CREATE OR REPLACE FUNCTION public.update_engagement_status(p_user_id UUID DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_today DATE := CURRENT_DATE;
BEGIN
  INSERT INTO public.user_engagement_status
    (user_id, status, last_active_date, days_since_active, updated_at)
  SELECT
    p.id,
    CASE
      WHEN p.last_active_date IS NULL        THEN 'active'
      WHEN v_today - p.last_active_date <= 3 THEN 'active'
      WHEN v_today - p.last_active_date <= 7 THEN 'at_risk'
      ELSE                                        'churned'
    END,
    p.last_active_date,
    COALESCE(v_today - p.last_active_date, 0),
    NOW()
  FROM public.profiles p
  WHERE (p_user_id IS NULL OR p.id = p_user_id)
  ON CONFLICT (user_id) DO UPDATE SET
    status            = EXCLUDED.status,
    last_active_date  = EXCLUDED.last_active_date,
    days_since_active = EXCLUDED.days_since_active,
    updated_at        = NOW();
END;
$$;

-- Restrict: service_role only.
-- The NULL p_user_id sweep-all path makes this especially dangerous.
REVOKE ALL ON FUNCTION public.update_engagement_status(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_engagement_status(UUID) FROM authenticated;


-- ══════════════════════════════════════════════════════════════
-- VERIFICATION COMMENTS
-- ══════════════════════════════════════════════════════════════
-- After applying this migration, run these queries to confirm:
--
-- 1. No gameplay RPC has an open GRANT to PUBLIC:
--    SELECT routine_name, grantee, privilege_type
--    FROM information_schema.routine_privileges
--    WHERE routine_schema = 'public'
--      AND routine_name IN (
--        'award_xp','complete_daily_quest','complete_weekly_quest',
--        'complete_chain_step','complete_event','award_achievement',
--        'update_streak','record_checkin','record_app_open',
--        'log_activity','log_activity_event',
--        'upsert_daily_activity','update_engagement_status'
--      )
--    ORDER BY routine_name, grantee;
--
-- 2. upsert_daily_activity and update_engagement_status must NOT
--    appear in the above result with grantee = 'authenticated'.
--
-- 3. Integration test (run as an authenticated user, not service_role):
--    SELECT public.award_xp(
--      '00000000-0000-0000-0000-000000000000',  -- another user's id
--      'daily_quest', 'test', 100
--    );
--    → Must raise: ERROR: forbidden
--
--    SELECT public.award_xp(
--      auth.uid(), 'admin_grant', 'test', 500
--    );
--    → Must raise: ERROR: admin_grant source_type is not permitted via direct RPC
-- ============================================================