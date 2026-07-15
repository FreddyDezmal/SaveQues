-- ─────────────────────────────────────────────────────────────────────────────
-- 055_down.sql
-- Rollback for 055_performance_audit.sql
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.leaderboard_xp(TEXT, UUID, TEXT, INT);
DROP FUNCTION IF EXISTS public.leaderboard_streak(TEXT, UUID, INT);
DROP FUNCTION IF EXISTS public.leaderboard_goals_completed(TEXT, UUID, INT);
DROP FUNCTION IF EXISTS public.leaderboard_group_contributions(UUID, INT);
DROP FUNCTION IF EXISTS public.leaderboard_consistency_inputs(TEXT, UUID, INT);
DROP FUNCTION IF EXISTS public.leaderboard_my_groups(INT);

-- Restore the pre-055 (unlimited) signatures
CREATE OR REPLACE FUNCTION public.leaderboard_xp(p_scope TEXT, p_group_id UUID DEFAULT NULL, p_period TEXT DEFAULT 'week')
RETURNS TABLE (user_id UUID, username TEXT, display_name TEXT, avatar_emoji TEXT, xp_in_period BIGINT, rank INTEGER)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_period_start TIMESTAMPTZ;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF p_period NOT IN ('week', 'month') THEN
    RAISE EXCEPTION 'invalid period: %, must be ''week'' or ''month''', p_period USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_period_start := date_trunc(p_period, NOW());
  RETURN QUERY
  WITH members AS (SELECT * FROM public.leaderboard_member_set(v_caller, p_scope, p_group_id)),
       totals AS (
         SELECT xa.user_id AS uid, SUM(xa.xp_awarded) AS total FROM public.xp_awards xa
         JOIN members m ON m.member_id = xa.user_id WHERE xa.created_at >= v_period_start GROUP BY xa.user_id
       )
  SELECT p.id, p.username, p.display_name, p.avatar_emoji, COALESCE(t.total, 0)::BIGINT,
         RANK() OVER (ORDER BY COALESCE(t.total, 0) DESC)::INTEGER
  FROM members m JOIN public.profiles p ON p.id = m.member_id LEFT JOIN totals t ON t.uid = m.member_id
  ORDER BY 5 DESC, p.display_name ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.leaderboard_streak(p_scope TEXT, p_group_id UUID DEFAULT NULL)
RETURNS TABLE (user_id UUID, username TEXT, display_name TEXT, avatar_emoji TEXT, current_streak_days INTEGER, longest_streak INTEGER, rank INTEGER)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_caller UUID := auth.uid();
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'insufficient_privilege'; END IF;
  RETURN QUERY
  SELECT p.id, p.username, p.display_name, p.avatar_emoji, p.streak_days, p.longest_streak,
         RANK() OVER (ORDER BY p.longest_streak DESC)::INTEGER
  FROM public.leaderboard_member_set(v_caller, p_scope, p_group_id) m
  JOIN public.profiles p ON p.id = m.member_id
  ORDER BY 6 ASC, p.display_name ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.leaderboard_goals_completed(p_scope TEXT, p_group_id UUID DEFAULT NULL)
RETURNS TABLE (user_id UUID, username TEXT, display_name TEXT, avatar_emoji TEXT, goals_completed INTEGER, rank INTEGER)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_caller UUID := auth.uid();
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'insufficient_privilege'; END IF;
  RETURN QUERY
  WITH members AS (SELECT * FROM public.leaderboard_member_set(v_caller, p_scope, p_group_id)),
       counts AS (
         SELECT g.user_id AS uid, COUNT(*) AS n FROM public.savings_goals g
         JOIN members m ON m.member_id = g.user_id WHERE g.is_complete = TRUE GROUP BY g.user_id
       )
  SELECT p.id, p.username, p.display_name, p.avatar_emoji, COALESCE(c.n, 0)::INTEGER,
         RANK() OVER (ORDER BY COALESCE(c.n, 0) DESC)::INTEGER
  FROM members m JOIN public.profiles p ON p.id = m.member_id LEFT JOIN counts c ON c.uid = m.member_id
  ORDER BY 5 DESC, p.display_name ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.leaderboard_group_contributions(p_group_id UUID)
RETURNS TABLE (user_id UUID, username TEXT, display_name TEXT, avatar_emoji TEXT, contribution_count INTEGER, rank INTEGER)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_caller UUID := auth.uid();
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF p_group_id IS NULL THEN RAISE EXCEPTION 'p_group_id is required' USING ERRCODE = 'invalid_parameter_value'; END IF;
  RETURN QUERY
  WITH members AS (SELECT * FROM public.leaderboard_member_set(v_caller, 'group', p_group_id)),
       counts AS (
         SELECT gc.user_id AS uid, COUNT(*) AS n FROM public.group_contributions gc
         JOIN public.shared_goals sg ON sg.id = gc.shared_goal_id
         JOIN members m ON m.member_id = gc.user_id WHERE sg.group_id = p_group_id GROUP BY gc.user_id
       )
  SELECT p.id, p.username, p.display_name, p.avatar_emoji, COALESCE(c.n, 0)::INTEGER,
         RANK() OVER (ORDER BY COALESCE(c.n, 0) DESC)::INTEGER
  FROM members m JOIN public.profiles p ON p.id = m.member_id LEFT JOIN counts c ON c.uid = m.member_id
  ORDER BY 5 DESC, p.display_name ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.leaderboard_consistency_inputs(p_scope TEXT, p_group_id UUID DEFAULT NULL)
RETURNS TABLE (user_id UUID, username TEXT, display_name TEXT, avatar_emoji TEXT, deposit_dates TIMESTAMPTZ[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_caller UUID := auth.uid();
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'insufficient_privilege'; END IF;
  RETURN QUERY
  SELECT p.id, p.username, p.display_name, p.avatar_emoji,
         COALESCE((
           SELECT array_agg(d.created_at ORDER BY d.created_at) FROM (
             SELECT t.created_at FROM public.transactions t
             WHERE t.user_id = p.id AND t.transaction_type = 'deposit'
             ORDER BY t.created_at DESC LIMIT 200
           ) d
         ), ARRAY[]::TIMESTAMPTZ[])
  FROM public.leaderboard_member_set(v_caller, p_scope, p_group_id) m
  JOIN public.profiles p ON p.id = m.member_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.leaderboard_my_groups()
RETURNS TABLE (group_id UUID, name TEXT, emoji TEXT, xp_total INTEGER, my_role TEXT, rank INTEGER)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_caller UUID := auth.uid();
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'insufficient_privilege'; END IF;
  RETURN QUERY
  SELECT g.id, g.name, g.emoji, g.xp_total, gm.role, RANK() OVER (ORDER BY g.xp_total DESC)::INTEGER
  FROM public.group_members gm JOIN public.groups g ON g.id = gm.group_id
  WHERE gm.user_id = v_caller AND gm.status = 'active'
  ORDER BY 6 ASC, g.name ASC;
END;
$$;

DROP INDEX IF EXISTS public.idx_group_contributions_goal_user;
DROP INDEX IF EXISTS public.idx_transactions_deposit_user_created;
