-- ─────────────────────────────────────────────────────────────────────────────
-- 033_admin_read_policies.sql
-- Admin read access for UserActivityDrawer
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHY
--   UserActivityDrawer fetches activity data for a selected user via the
--   Supabase client SDK directly from the browser. All five tables it reads
--   (transactions, daily_quest_logs, user_achievements, user_challenges,
--   savings_goals) have RLS policies of the form `auth.uid() = user_id`,
--   which means admins can only ever see their own rows — every other user's
--   drawer silently returns empty data.
--
-- FIX
--   Add a SELECT-only policy on each table that allows any authenticated user
--   whose profile has is_admin = TRUE to read any row. This follows the same
--   pattern already used for challenges/badges/events admin policies in
--   migration 016 (USING EXISTS(...is_admin = TRUE)).
--
--   SELECT-only (not ALL) — admins should read other users' data for support
--   purposes, never write it through this path. Writes remain restricted to
--   the row owner via the existing user policies.
-- ─────────────────────────────────────────────────────────────────────────────

-- Helper: reusable admin check expression used in every policy below.
-- EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE)

CREATE POLICY "Admins can read all transactions"
  ON public.transactions
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

CREATE POLICY "Admins can read all savings_goals"
  ON public.savings_goals
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

CREATE POLICY "Admins can read all daily_quest_logs"
  ON public.daily_quest_logs
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

CREATE POLICY "Admins can read all user_achievements"
  ON public.user_achievements
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

CREATE POLICY "Admins can read all user_challenges"
  ON public.user_challenges
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );