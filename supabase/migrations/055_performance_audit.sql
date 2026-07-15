-- ─────────────────────────────────────────────────────────────────────────────
-- 055_performance_audit.sql
-- Sprint 22, Phase 13 — Performance
--
-- Full findings in PERFORMANCE_AUDIT.md (delivered alongside this
-- migration). This is the concrete subset that warranted schema changes.
-- Existing, pre-sprint indexes (024_performance_indexes.sql) are
-- untouched — new, narrowly-scoped indexes are added instead of altering
-- ones already tuned and documented for other query paths.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- PART A — Two missing indexes for query patterns this sprint introduced
-- ═══════════════════════════════════════════════════════════════════════════

-- group_quest_raw_progress (050) and leaderboard_consistency_inputs (052)
-- both filter transactions by transaction_type='deposit' across a whole
-- friends/group member set, then range by created_at. The existing
-- idx_transactions_user_created_at (024) is (user_id, created_at) with no
-- transaction_type — every non-deposit row (withdrawal, purchase,
-- adjustment) in range still gets pulled off the index page and filtered
-- out. A partial index scoped to exactly this sprint's query shape, left
-- alongside (not replacing) the original — the original still serves
-- every pre-existing query path that needs all transaction types.
CREATE INDEX IF NOT EXISTS idx_transactions_deposit_user_created
  ON public.transactions (user_id, created_at)
  WHERE transaction_type = 'deposit';

-- get_shared_goal_detail's (049) per-member SUM subquery and
-- leaderboard_group_contributions' (052) GROUP BY both filter/aggregate
-- by (shared_goal_id, user_id) together. The existing idx_group_
-- contributions_goal (045) is (shared_goal_id, created_at) — good for
-- "this goal's contributions in order," not for "this goal, this
-- member's total."
CREATE INDEX IF NOT EXISTS idx_group_contributions_goal_user
  ON public.group_contributions (shared_goal_id, user_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- PART B — Leaderboards had no LIMIT at all
-- ═══════════════════════════════════════════════════════════════════════════
-- Friends-scope is self-bounding (nobody has an unbounded friends list),
-- but group-scope isn't — a large group would return every member,
-- unranked-by-cutoff, on every request. "Leaderboard" implies a top N,
-- not literally everyone. Added p_limit (default 50, capped at 100) to
-- every ranking function.
--
-- IMPORTANT — corrected from this migration's first draft: adding a
-- parameter via CREATE OR REPLACE does NOT replace the old function.
-- Postgres identifies a function by name + parameter type list, so a
-- changed signature creates a SECOND overload alongside the original,
-- and an old 3-argument call becomes ambiguous between "the 3-arg
-- function" and "the 4-arg function with its default filled in" —
-- exactly the opposite of backward compatible. Caught by actually
-- calling these with the old argument count after the first draft,
-- which failed with "is not unique". Every OLD signature is dropped
-- explicitly below before the new one is created.

DROP FUNCTION IF EXISTS public.leaderboard_xp(TEXT, UUID, TEXT);
DROP FUNCTION IF EXISTS public.leaderboard_streak(TEXT, UUID);
DROP FUNCTION IF EXISTS public.leaderboard_goals_completed(TEXT, UUID);
DROP FUNCTION IF EXISTS public.leaderboard_group_contributions(UUID);
DROP FUNCTION IF EXISTS public.leaderboard_consistency_inputs(TEXT, UUID);
DROP FUNCTION IF EXISTS public.leaderboard_my_groups();

CREATE OR REPLACE FUNCTION public.leaderboard_xp(
  p_scope TEXT, p_group_id UUID DEFAULT NULL, p_period TEXT DEFAULT 'week', p_limit INT DEFAULT 50
)
RETURNS TABLE (
  user_id UUID, username TEXT, display_name TEXT, avatar_emoji TEXT,
  xp_in_period BIGINT, rank INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_period_start TIMESTAMPTZ;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_period NOT IN ('week', 'month') THEN
    RAISE EXCEPTION 'invalid period: %, must be ''week'' or ''month''', p_period
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_period_start := date_trunc(p_period, NOW());

  RETURN QUERY
  WITH members AS (SELECT * FROM public.leaderboard_member_set(v_caller, p_scope, p_group_id)),
       totals AS (
         SELECT xa.user_id AS uid, SUM(xa.xp_awarded) AS total
         FROM public.xp_awards xa
         JOIN members m ON m.member_id = xa.user_id
         WHERE xa.created_at >= v_period_start
         GROUP BY xa.user_id
       )
  SELECT p.id, p.username, p.display_name, p.avatar_emoji,
         COALESCE(t.total, 0)::BIGINT,
         RANK() OVER (ORDER BY COALESCE(t.total, 0) DESC)::INTEGER
  FROM members m
  JOIN public.profiles p ON p.id = m.member_id
  LEFT JOIN totals t ON t.uid = m.member_id
  ORDER BY 5 DESC, p.display_name ASC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
END;
$$;

CREATE OR REPLACE FUNCTION public.leaderboard_streak(p_scope TEXT, p_group_id UUID DEFAULT NULL, p_limit INT DEFAULT 50)
RETURNS TABLE (
  user_id UUID, username TEXT, display_name TEXT, avatar_emoji TEXT,
  current_streak_days INTEGER, longest_streak INTEGER, rank INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller UUID := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT p.id, p.username, p.display_name, p.avatar_emoji,
         p.streak_days, p.longest_streak,
         RANK() OVER (ORDER BY p.longest_streak DESC)::INTEGER
  FROM public.leaderboard_member_set(v_caller, p_scope, p_group_id) m
  JOIN public.profiles p ON p.id = m.member_id
  ORDER BY 6 ASC, p.display_name ASC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
END;
$$;

CREATE OR REPLACE FUNCTION public.leaderboard_goals_completed(p_scope TEXT, p_group_id UUID DEFAULT NULL, p_limit INT DEFAULT 50)
RETURNS TABLE (
  user_id UUID, username TEXT, display_name TEXT, avatar_emoji TEXT,
  goals_completed INTEGER, rank INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller UUID := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH members AS (SELECT * FROM public.leaderboard_member_set(v_caller, p_scope, p_group_id)),
       counts AS (
         SELECT g.user_id AS uid, COUNT(*) AS n
         FROM public.savings_goals g
         JOIN members m ON m.member_id = g.user_id
         WHERE g.is_complete = TRUE
         GROUP BY g.user_id
       )
  SELECT p.id, p.username, p.display_name, p.avatar_emoji,
         COALESCE(c.n, 0)::INTEGER,
         RANK() OVER (ORDER BY COALESCE(c.n, 0) DESC)::INTEGER
  FROM members m
  JOIN public.profiles p ON p.id = m.member_id
  LEFT JOIN counts c ON c.uid = m.member_id
  ORDER BY 5 DESC, p.display_name ASC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
END;
$$;

CREATE OR REPLACE FUNCTION public.leaderboard_group_contributions(p_group_id UUID, p_limit INT DEFAULT 50)
RETURNS TABLE (
  user_id UUID, username TEXT, display_name TEXT, avatar_emoji TEXT,
  contribution_count INTEGER, rank INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller UUID := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_group_id IS NULL THEN
    RAISE EXCEPTION 'p_group_id is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN QUERY
  WITH members AS (SELECT * FROM public.leaderboard_member_set(v_caller, 'group', p_group_id)),
       counts AS (
         SELECT gc.user_id AS uid, COUNT(*) AS n
         FROM public.group_contributions gc
         JOIN public.shared_goals sg ON sg.id = gc.shared_goal_id
         JOIN members m ON m.member_id = gc.user_id
         WHERE sg.group_id = p_group_id
         GROUP BY gc.user_id
       )
  SELECT p.id, p.username, p.display_name, p.avatar_emoji,
         COALESCE(c.n, 0)::INTEGER,
         RANK() OVER (ORDER BY COALESCE(c.n, 0) DESC)::INTEGER
  FROM members m
  JOIN public.profiles p ON p.id = m.member_id
  LEFT JOIN counts c ON c.uid = m.member_id
  ORDER BY 5 DESC, p.display_name ASC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
END;
$$;

-- leaderboard_consistency_inputs (052) doesn't rank — scoring happens in
-- the API route, app-side, per get_activity_feed-adjacent reasoning about
-- not duplicating lib/analyticsEngine.ts's formula in SQL. It still gets
-- a member-count cap here (a group could have more members than are
-- reasonable to score and return in one response), separate from the
-- existing per-member 200-deposit cap it already had.
CREATE OR REPLACE FUNCTION public.leaderboard_consistency_inputs(p_scope TEXT, p_group_id UUID DEFAULT NULL, p_limit INT DEFAULT 50)
RETURNS TABLE (
  user_id UUID, username TEXT, display_name TEXT, avatar_emoji TEXT,
  deposit_dates TIMESTAMPTZ[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller UUID := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT p.id, p.username, p.display_name, p.avatar_emoji,
         COALESCE((
           SELECT array_agg(d.created_at ORDER BY d.created_at)
           FROM (
             SELECT t.created_at FROM public.transactions t
             WHERE t.user_id = p.id AND t.transaction_type = 'deposit'
             ORDER BY t.created_at DESC
             LIMIT 200
           ) d
         ), ARRAY[]::TIMESTAMPTZ[])
  FROM public.leaderboard_member_set(v_caller, p_scope, p_group_id) m
  JOIN public.profiles p ON p.id = m.member_id
  ORDER BY p.display_name ASC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
END;
$$;

CREATE OR REPLACE FUNCTION public.leaderboard_my_groups(p_limit INT DEFAULT 50)
RETURNS TABLE (
  group_id UUID, name TEXT, emoji TEXT, xp_total INTEGER, my_role TEXT, rank INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller UUID := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT g.id, g.name, g.emoji, g.xp_total, gm.role,
         RANK() OVER (ORDER BY g.xp_total DESC)::INTEGER
  FROM public.group_members gm
  JOIN public.groups g ON g.id = gm.group_id
  WHERE gm.user_id = v_caller AND gm.status = 'active'
  ORDER BY 6 ASC, g.name ASC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
END;
$$;
