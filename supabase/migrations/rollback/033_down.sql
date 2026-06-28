-- ─────────────────────────────────────────────────────────────────────────────
-- 033_down.sql
-- Rollback for 033_admin_read_policies.sql
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Admins can read all transactions"     ON public.transactions;
DROP POLICY IF EXISTS "Admins can read all savings_goals"    ON public.savings_goals;
DROP POLICY IF EXISTS "Admins can read all daily_quest_logs" ON public.daily_quest_logs;
DROP POLICY IF EXISTS "Admins can read all user_achievements" ON public.user_achievements;
DROP POLICY IF EXISTS "Admins can read all user_challenges"  ON public.user_challenges;