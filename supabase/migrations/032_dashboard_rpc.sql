-- ─────────────────────────────────────────────────────────────────────────────
-- 032_dashboard_rpc.sql
-- Sprint 13 — P1: Dashboard Query Consolidation
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Reduces the dashboard from 17 round-trips (worst case) to 1.
-- Full rationale in SPRINT13_DELIVERABLES.md.
--
-- Fix note (v2): removed nested DECLARE blocks (fragile in Supabase's
-- PostgREST layer) and moved LIMIT out of UNION ALL members (invalid SQL).
-- All variables are declared at the top-level DECLARE section.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_dashboard_data(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile              RECORD;
  v_goals                JSONB;
  v_active_challenges    JSONB;
  v_achievements         JSONB;
  v_activity_log         JSONB;
  v_today_quest          JSONB;
  v_chain_progress       JSONB;
  v_has_deposit          BOOLEAN;
  v_all_transactions     JSONB;
  v_completed_challenges JSONB;
  v_timeline_events      JSONB;
  v_streak_update        JSONB;
  v_today                DATE;
BEGIN
  -- C1 ownership guard
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_today := CURRENT_DATE;

  -- ── 1. Profile ────────────────────────────────────────────────────────────
  -- Note: removed FOR UPDATE lock. The streak update below issues its own
  -- UPDATE which implicitly acquires a row lock at that point. Holding a
  -- SELECT FOR UPDATE here caused deadlocks for new users where the auth
  -- callback's starter-goal fetch and the dashboard page load hit the same
  -- profile row simultaneously (both within milliseconds of email confirmation).
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = 'no_data_found';
  END IF;

  -- ── 2. Streak update (integrated) ────────────────────────────────────────
  -- Only runs on first load of the day. Calls the existing update_streak()
  -- RPC to preserve its shield/milestone logic rather than duplicating it.
  IF v_profile.last_active_date IS DISTINCT FROM v_today
    AND (v_profile.streak_paused_until IS NULL
         OR v_profile.streak_paused_until::DATE <= v_today)
  THEN
    SELECT public.update_streak(p_user_id) INTO v_streak_update;
    -- Re-read profile to get post-streak values
    SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  END IF;

  -- ── 3. Goals ──────────────────────────────────────────────────────────────
  SELECT jsonb_agg(
    jsonb_build_object(
      'id',             g.id,
      'title',          g.title,
      'category',       g.category,
      'goal_emoji',     g.goal_emoji,
      'target_amount',  g.target_amount,
      'current_amount', g.current_amount,
      'is_complete',    g.is_complete,
      'target_date',    g.target_date,
      'created_at',     g.created_at
    )
    ORDER BY g.created_at DESC
  ) INTO v_goals
  FROM public.savings_goals g
  WHERE g.user_id = p_user_id;

  -- ── 4. Active challenges ──────────────────────────────────────────────────
  SELECT jsonb_agg(
    jsonb_build_object(
      'id',           uc.id,
      'challenge_id', uc.challenge_id,
      'status',       uc.status,
      'completed_at', uc.completed_at,
      'challenge',    jsonb_build_object(
        'id',          c.id,
        'title',       c.title,
        'description', c.description,
        'xp_reward',   c.xp_reward,
        'type',        c.type
      )
    )
  ) INTO v_active_challenges
  FROM public.user_challenges uc
  JOIN public.challenges c ON c.id = uc.challenge_id
  WHERE uc.user_id = p_user_id AND uc.status = 'active';

  -- ── 5. Achievements ───────────────────────────────────────────────────────
  SELECT jsonb_agg(
    jsonb_build_object(
      'achievement_id', ua.achievement_id,
      'earned_at',      ua.earned_at
    )
    ORDER BY ua.earned_at DESC
  ) INTO v_achievements
  FROM public.user_achievements ua
  WHERE ua.user_id = p_user_id;

  -- ── 6. Activity log (30-day heatmap) ──────────────────────────────────────
  SELECT jsonb_agg(
    jsonb_build_object(
      'date',          al.activity_date,
      'xp_earned',     al.xp_earned,
      'actions_count', al.actions_count
    )
    ORDER BY al.activity_date DESC
  ) INTO v_activity_log
  FROM public.activity_log al
  WHERE al.user_id = p_user_id
    AND al.activity_date >= (CURRENT_DATE - INTERVAL '30 days')::DATE;

  -- ── 7. Today's quest ──────────────────────────────────────────────────────
  SELECT jsonb_build_object(
    'completed', true,
    'quest_id',  dql.quest_id
  ) INTO v_today_quest
  FROM public.daily_quest_logs dql
  WHERE dql.user_id = p_user_id
    AND dql.quest_date = CURRENT_DATE
  LIMIT 1;

  IF v_today_quest IS NULL THEN
    v_today_quest := jsonb_build_object('completed', false, 'quest_id', null);
  END IF;

  -- ── 8. Quest chain progress ───────────────────────────────────────────────
  SELECT jsonb_agg(
    jsonb_build_object(
      'chain_id',     qcp.chain_id,
      'current_step', qcp.current_step,
      'status',       qcp.status,
      'started_at',   qcp.started_at,
      'completed_at', qcp.completed_at
    )
  ) INTO v_chain_progress
  FROM public.quest_chain_progress qcp
  WHERE qcp.user_id = p_user_id;

  -- ── 9. Has deposit ────────────────────────────────────────────────────────
  SELECT EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.user_id = p_user_id
      AND t.amount > 0
      AND t.transaction_type = 'deposit'
    LIMIT 1
  ) INTO v_has_deposit;

  -- ── 10. Transactions for timeline ─────────────────────────────────────────
  SELECT jsonb_agg(
    jsonb_build_object(
      'id',               t.id,
      'amount',           t.amount,
      'note',             t.note,
      'created_at',       t.created_at,
      'goal_id',          t.goal_id,
      'transaction_type', t.transaction_type,
      'title',            g.title,
      'category',         g.category
    )
    ORDER BY t.created_at DESC
  ) INTO v_all_transactions
  FROM public.transactions t
  LEFT JOIN public.savings_goals g ON g.id = t.goal_id
  WHERE t.user_id = p_user_id;

  -- ── 11. Completed challenges for timeline ─────────────────────────────────
  SELECT jsonb_agg(
    jsonb_build_object(
      'id',           uc.id,
      'challenge_id', uc.challenge_id,
      'completed_at', uc.completed_at,
      'challenge',    jsonb_build_object(
        'title',     c.title,
        'xp_reward', c.xp_reward
      )
    )
    ORDER BY uc.completed_at DESC
  ) INTO v_completed_challenges
  FROM public.user_challenges uc
  JOIN public.challenges c ON c.id = uc.challenge_id
  WHERE uc.user_id = p_user_id
    AND uc.status = 'completed'
    AND uc.completed_at IS NOT NULL;

  -- ── 12. Timeline preview (5 most recent events across all types) ──────────
  -- Each UNION ALL member is wrapped in a subquery so LIMIT can be applied
  -- per-source before combining (valid SQL: LIMIT on a subquery, not a
  -- UNION member directly).
  SELECT jsonb_agg(evt ORDER BY (evt->>'timestamp') DESC)
  INTO v_timeline_events
  FROM (
    SELECT evt FROM (
      SELECT jsonb_build_object(
        'id',        'tx_' || (t->>'id'),
        'type',      CASE
                       WHEN t->>'transaction_type' = 'withdrawal' THEN 'withdrawal'
                       WHEN t->>'transaction_type' = 'goal_purchase' THEN 'goal_purchase'
                       ELSE 'deposit'
                     END,
        'timestamp', t->>'created_at',
        'meta',      jsonb_build_object(
                       'type',         CASE
                                         WHEN t->>'transaction_type' = 'withdrawal' THEN 'withdrawal'
                                         WHEN t->>'transaction_type' = 'goal_purchase' THEN 'goal_purchase'
                                         ELSE 'deposit'
                                       END,
                       'amount',       (t->>'amount')::NUMERIC,
                       'goalId',       t->>'goal_id',
                       'goalTitle',    t->>'title',
                       'goalCategory', t->>'category',
                       'note',         t->>'note'
                     )
      ) AS evt
      FROM jsonb_array_elements(COALESCE(v_all_transactions, '[]'::JSONB)) AS t
      LIMIT 10
    ) tx_limited

    UNION ALL

    SELECT jsonb_build_object(
      'id',        'achievement_' || (ua->>'achievement_id'),
      'type',      'achievement_earned',
      'timestamp', ua->>'earned_at',
      'meta',      jsonb_build_object('achievementId', ua->>'achievement_id')
    ) AS evt
    FROM jsonb_array_elements(COALESCE(v_achievements, '[]'::JSONB)) AS ua

    UNION ALL

    SELECT jsonb_build_object(
      'id',        'quest_' || (uc->>'id'),
      'type',      'quest_completed',
      'timestamp', uc->>'completed_at',
      'meta',      jsonb_build_object(
                     'challengeId',    uc->>'challenge_id',
                     'challengeTitle', (uc->'challenge'->>'title'),
                     'xpReward',       (uc->'challenge'->>'xp_reward')::INTEGER
                   )
    ) AS evt
    FROM jsonb_array_elements(COALESCE(v_completed_challenges, '[]'::JSONB)) AS uc
  ) all_events
  LIMIT 5;

  -- ── 13. Return ────────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'profile',           row_to_json(v_profile)::JSONB,
    'goals',             COALESCE(v_goals, '[]'::JSONB),
    'active_challenges', COALESCE(v_active_challenges, '[]'::JSONB),
    'achievements',      COALESCE(v_achievements, '[]'::JSONB),
    'activity_log',      COALESCE(v_activity_log, '[]'::JSONB),
    'today_quest',       v_today_quest,
    'chain_progress',    COALESCE(v_chain_progress, '[]'::JSONB),
    'has_deposit',       v_has_deposit,
    'timeline_preview',  COALESCE(v_timeline_events, '[]'::JSONB)
  );

END;
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_data(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dashboard_data(UUID) TO authenticated;