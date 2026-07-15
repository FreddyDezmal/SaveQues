-- ─────────────────────────────────────────────────────────────────────────────
-- 052_down.sql
-- Rollback for 052_leaderboards.sql
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.leaderboard_my_groups();
DROP FUNCTION IF EXISTS public.leaderboard_group_contributions(UUID);
DROP FUNCTION IF EXISTS public.leaderboard_consistency_inputs(TEXT, UUID);
DROP FUNCTION IF EXISTS public.leaderboard_goals_completed(TEXT, UUID);
DROP FUNCTION IF EXISTS public.leaderboard_streak(TEXT, UUID);
DROP FUNCTION IF EXISTS public.leaderboard_xp(TEXT, UUID, TEXT);
DROP FUNCTION IF EXISTS public.leaderboard_member_set(UUID, TEXT, UUID);
