-- ============================================================
-- SaveQuest Migration 011 — Transaction Guards & Action RPCs
-- ============================================================
-- 1. enforce_transaction_goal_ownership trigger
--      Prevents a user from inserting a transaction against
--      another user's goal — which would fire the SECURITY
--      DEFINER update_goal_amount() trigger and inflate their
--      balance without going through any XP route.
--
-- 2. Action-completion SECURITY DEFINER functions
--      Each function combines a state-guard UPDATE (WHERE
--      status = 'active') with a call to award_xp(), making
--      the entire award exactly-once under concurrent load.
--
--      complete_daily_quest()   — daily quest log + XP
--      complete_weekly_quest()  — weekly quest state + XP
--      complete_chain_step()    — chain progress advance + XP
--      complete_event()         — event participation + XP
--      award_achievement()      — achievement row + XP
--
-- Depends on: 009 (award_xp), 006 (user_weekly_quests),
--             002 (daily_quest_logs, quest_chain_progress),
--             007 (user_event_participation),
--             001 (user_achievements, transactions)
-- ============================================================


-- ── 1. TRANSACTION GOAL OWNERSHIP GUARD ──────────────────────
-- The BEFORE INSERT trigger runs before update_goal_amount(),
-- so a cross-user injection never reaches the balance logic.
CREATE OR REPLACE FUNCTION public.enforce_transaction_goal_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.savings_goals
    WHERE id      = NEW.goal_id
      AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION
      'Goal % does not belong to user %', NEW.goal_id, NEW.user_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_goal_ownership ON public.transactions;
CREATE TRIGGER enforce_goal_ownership
  BEFORE INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_transaction_goal_ownership();


-- ── 2. complete_daily_quest() ─────────────────────────────────
-- Called by POST /api/quest/daily/complete.
-- Idempotency key: (user_id, 'daily_quest', quest_date::TEXT)
-- A second call on the same calendar day returns already_awarded.
CREATE OR REPLACE FUNCTION public.complete_daily_quest(
  p_user_id    UUID,
  p_quest_id   TEXT,
  p_quest_date DATE,
  p_xp         INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Award XP first — idempotent on quest_date
  SELECT public.award_xp(p_user_id, 'daily_quest', p_quest_date::TEXT, p_xp)
  INTO v_result;

  IF (v_result->>'reason') = 'already_awarded' THEN
    RETURN v_result;
  END IF;

  -- Log the quest completion (idempotent via unique constraint)
  INSERT INTO public.daily_quest_logs (user_id, quest_id, quest_date, xp_earned)
  VALUES (p_user_id, p_quest_id, p_quest_date, p_xp)
  ON CONFLICT (user_id, quest_date) DO NOTHING;

  -- Increment counter only when XP was actually granted this call
  IF (v_result->>'xp_awarded')::INTEGER > 0 THEN
    UPDATE public.profiles
    SET daily_quests_completed = daily_quests_completed + 1
    WHERE id = p_user_id;
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_daily_quest(UUID, TEXT, DATE, INTEGER)
  TO authenticated;


-- ── 3. complete_weekly_quest() ────────────────────────────────
-- Called by POST /api/quest/weekly/complete.
-- Status guard: UPDATE WHERE status = 'active' — concurrent calls
-- both attempt the same UPDATE; only one wins (0 rows for the other).
CREATE OR REPLACE FUNCTION public.complete_weekly_quest(
  p_user_id    UUID,
  p_quest_id   TEXT,
  p_week_start DATE,
  p_xp         INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_rows   INTEGER;
BEGIN
  UPDATE public.user_weekly_quests
  SET status       = 'completed',
      completed_at = NOW(),
      xp_earned    = p_xp
  WHERE user_id    = p_user_id
    AND week_start = p_week_start
    AND status     = 'active';

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- Row not found means quest was never accepted, already completed,
  -- or a concurrent call already flipped the status — all safe.
  IF v_rows = 0 THEN
    RETURN jsonb_build_object(
      'success',    true,
      'xp_awarded', 0,
      'reason',     'already_awarded'
    );
  END IF;

  SELECT public.award_xp(p_user_id, 'weekly_quest', p_week_start::TEXT, p_xp)
  INTO v_result;

  IF (v_result->>'xp_awarded')::INTEGER > 0 THEN
    UPDATE public.profiles
    SET weekly_quests_completed = weekly_quests_completed + 1
    WHERE id = p_user_id;
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_weekly_quest(UUID, TEXT, DATE, INTEGER)
  TO authenticated;


-- ── 4. complete_chain_step() ──────────────────────────────────
-- Called by POST /api/quest/chain/step.
-- Step guard: UPDATE WHERE current_step = p_step AND status = 'active'
-- ensures a step can only be claimed once and in the correct order.
CREATE OR REPLACE FUNCTION public.complete_chain_step(
  p_user_id  UUID,
  p_chain_id TEXT,
  p_step     INTEGER,
  p_step_xp  INTEGER,
  p_is_last  BOOLEAN,
  p_chain_xp INTEGER   -- completion bonus; 0 when not the last step
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step_result  JSONB;
  v_chain_result JSONB;
  v_next_step    INTEGER := p_step + 1;
  v_rows         INTEGER;
BEGIN
  UPDATE public.quest_chain_progress
  SET current_step = CASE WHEN p_is_last THEN p_step ELSE v_next_step END,
      status       = CASE WHEN p_is_last THEN 'completed' ELSE 'active' END,
      completed_at = CASE WHEN p_is_last THEN NOW() ELSE NULL END
  WHERE user_id      = p_user_id
    AND chain_id     = p_chain_id
    AND status       = 'active'
    AND current_step = p_step;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RETURN jsonb_build_object(
      'success',    true,
      'xp_awarded', 0,
      'reason',     'already_awarded'
    );
  END IF;

  -- Award step XP; idempotency key = "chain_id:step_number"
  SELECT public.award_xp(
    p_user_id,
    'chain_step',
    p_chain_id || ':' || p_step::TEXT,
    p_step_xp
  ) INTO v_step_result;

  -- Award chain completion bonus on the final step
  IF p_is_last AND p_chain_xp > 0 THEN
    SELECT public.award_xp(
      p_user_id,
      'chain_complete',
      p_chain_id,
      p_chain_xp
    ) INTO v_chain_result;

    UPDATE public.profiles
    SET quest_chains_completed = quest_chains_completed + 1
    WHERE id = p_user_id;
  END IF;

  RETURN jsonb_build_object(
    'success',    true,
    'xp_awarded', COALESCE((v_step_result->>'xp_awarded')::INTEGER,  0)
                + COALESCE((v_chain_result->>'xp_awarded')::INTEGER, 0),
    'new_total',  COALESCE(
                    (v_chain_result->>'new_total')::INTEGER,
                    (v_step_result->>'new_total')::INTEGER,
                    0
                  )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_chain_step(UUID, TEXT, INTEGER, INTEGER, BOOLEAN, INTEGER)
  TO authenticated;


-- ── 5. complete_event() ───────────────────────────────────────
-- Called by POST /api/events/complete.
-- Status guard: UPDATE WHERE status = 'active' — concurrent
-- completions safely collide on the state check, not on XP.
CREATE OR REPLACE FUNCTION public.complete_event(
  p_user_id    UUID,
  p_event_slug TEXT,
  p_xp         INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_rows   INTEGER;
BEGIN
  UPDATE public.user_event_participation
  SET status       = 'completed',
      completed_at = NOW(),
      xp_earned    = p_xp
  WHERE user_id    = p_user_id
    AND event_slug = p_event_slug
    AND status     = 'active';

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RETURN jsonb_build_object(
      'success',    true,
      'xp_awarded', 0,
      'reason',     'already_awarded'
    );
  END IF;

  SELECT public.award_xp(p_user_id, 'event_complete', p_event_slug, p_xp)
  INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_event(UUID, TEXT, INTEGER)
  TO authenticated;


-- ── 6. award_achievement() ────────────────────────────────────
-- Called by checkAndAwardAchievements() in lib/awardXP.ts.
-- Inserts the badge row and awards its XP atomically.
-- The UNIQUE (user_id, achievement_id) constraint on
-- user_achievements is the primary dedup guard here.
CREATE OR REPLACE FUNCTION public.award_achievement(
  p_user_id        UUID,
  p_achievement_id TEXT,
  p_xp             INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  INSERT INTO public.user_achievements (user_id, achievement_id, earned_at)
  VALUES (p_user_id, p_achievement_id, NOW())
  ON CONFLICT (user_id, achievement_id) DO NOTHING;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success',    true,
      'xp_awarded', 0,
      'reason',     'already_awarded'
    );
  END IF;

  SELECT public.award_xp(p_user_id, 'achievement', p_achievement_id, p_xp)
  INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.award_achievement(UUID, TEXT, INTEGER)
  TO authenticated;
