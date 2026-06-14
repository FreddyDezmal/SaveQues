-- ============================================================
-- SaveQuest Migration 012 — Streak Update RPC
-- ============================================================
-- Migration 010 locked streak_days, longest_streak,
-- streak_shields, and total_shields_used behind the hardened
-- profiles RLS policy, preventing direct browser writes.
--
-- The dashboard Server Component (app/(app)/dashboard/page.tsx)
-- still needs to update these fields on page load to advance
-- the user's streak. It does so by calling this SECURITY
-- DEFINER function, which bypasses the RLS restriction because
-- it runs as its owner (postgres), not the requesting user.
--
-- This is intentional: the Server Component is trusted
-- (runs on the server, authenticated via Supabase session),
-- and streak advancement is non-XP-granting, so it doesn't
-- need to go through award_xp().
--
-- Depends on: 010 (hardened RLS — this function is the
--             approved bypass for streak columns)
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_streak(
  p_user_id      UUID,
  p_today        DATE,
  p_new_streak   INTEGER,
  p_longest      INTEGER,
  p_shields      INTEGER,  -- new shield count after possible deduction
  p_shields_used INTEGER   -- cumulative total shields ever used
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET
    last_active_date   = p_today,
    streak_days        = p_new_streak,
    longest_streak     = p_longest,
    streak_shields     = p_shields,
    total_shields_used = p_shields_used
  WHERE id = p_user_id;
END;
$$;

-- Server Components call this via the authed Supabase client.
GRANT EXECUTE ON FUNCTION public.update_streak(UUID, DATE, INTEGER, INTEGER, INTEGER, INTEGER)
  TO authenticated;


-- ── DEPLOYMENT NOTE ───────────────────────────────────────────
-- After applying migrations 009–012, confirm all four are live:
--
--   SELECT routine_name
--   FROM information_schema.routines
--   WHERE routine_schema = 'public'
--     AND routine_name IN (
--       'award_xp',
--       'complete_daily_quest',
--       'complete_weekly_quest',
--       'complete_chain_step',
--       'complete_event',
--       'award_achievement',
--       'update_streak',
--       'enforce_transaction_goal_ownership'
--     )
--   ORDER BY routine_name;
--
-- Expected: 7 rows (enforce_... is a trigger function, not
-- listed under routines — verify it separately):
--
--   SELECT trigger_name, event_manipulation, action_timing
--   FROM information_schema.triggers
--   WHERE event_object_table = 'transactions'
--     AND trigger_name = 'enforce_goal_ownership';
--
-- And confirm the hardened RLS policy is in place:
--
--   SELECT policyname FROM pg_policies
--   WHERE tablename = 'profiles'
--   ORDER BY policyname;
