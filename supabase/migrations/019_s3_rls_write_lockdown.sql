-- ============================================================
-- SaveQuest Migration 019 — Sprint 3: RLS Write Lockdown
-- ============================================================
-- Hardens four tables that previously allowed full CRUD via the
-- `authenticated` role, replacing permissive FOR ALL policies
-- with minimal SELECT-only policies.
--
-- Write paths after this migration:
--   user_achievements        → award_achievement() RPC only (SECURITY DEFINER)
--   user_event_participation → INSERT via /api/events/join (server route, service_role)
--                              UPDATE via complete_event() RPC (SECURITY DEFINER)
--   user_challenges          → INSERT via /api/quest/challenge/accept (server route)
--                              UPDATE via /api/quest/challenge/complete (server route)
--   daily_quest_logs         → INSERT via complete_daily_quest() RPC (SECURITY DEFINER)
--
-- Admin reads (service_role client) are unaffected — service_role
-- bypasses RLS entirely.
--
-- Compatibility:
--   • EventCard.tsx handleJoin() direct insert → BROKEN (see note below)
--     Fix: moved to POST /api/events/join (new server route, deployed in this sprint)
--   • /api/quest/challenge/accept direct insert into user_challenges → still works
--     because that route uses the authenticated user session and the new
--     INSERT WITH CHECK (auth.uid() = user_id AND status = 'active') policy
--     allows only clean initial inserts.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- 1. user_achievements
-- ════════════════════════════════════════════════════════════
-- BEFORE: "Users can CRUD own achievements"  FOR ALL  USING (auth.uid() = user_id)
-- AFTER:  SELECT only. All writes go through award_achievement() SECURITY DEFINER.

DROP POLICY IF EXISTS "Users can CRUD own achievements" ON public.user_achievements;

CREATE POLICY "Users can read own achievements"
  ON public.user_achievements
  FOR SELECT
  USING (auth.uid() = user_id);

-- No INSERT / UPDATE / DELETE policy for authenticated role.
-- award_achievement() runs as SECURITY DEFINER and bypasses RLS,
-- so it continues to work. The C1 fix (migration 018) already ensures
-- award_achievement() enforces auth.uid() = p_user_id before writing.


-- ════════════════════════════════════════════════════════════
-- 2. user_event_participation
-- ════════════════════════════════════════════════════════════
-- BEFORE: "Users can CRUD own event participation"  FOR ALL  USING (auth.uid() = user_id)
-- AFTER:
--   SELECT  — own rows only
--   INSERT  — own rows only, status must be 'active' (join only, not self-completing)
--   No UPDATE / DELETE for authenticated role.
--   complete_event() SECURITY DEFINER handles the UPDATE to 'completed'.

DROP POLICY IF EXISTS "Users can CRUD own event participation" ON public.user_event_participation;

CREATE POLICY "Users can read own event participation"
  ON public.user_event_participation
  FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT is still needed: /api/events/join (new server route) uses the
-- authenticated session client. We allow INSERT but enforce:
--   • user_id must match the caller
--   • status must be 'active' (cannot self-insert a 'completed' row)
--   • xp_earned and completed_at must be NULL (cannot pre-populate completion fields)
CREATE POLICY "Users can join events (insert active row only)"
  ON public.user_event_participation
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'active'
    AND xp_earned IS NULL
    AND completed_at IS NULL
  );

-- No UPDATE policy: only complete_event() (SECURITY DEFINER) may update rows.
-- No DELETE policy: participation records are permanent audit trail.


-- ════════════════════════════════════════════════════════════
-- 3. user_challenges
-- ════════════════════════════════════════════════════════════
-- BEFORE: "Users can CRUD own user_challenges"  FOR ALL  USING (auth.uid() = user_id)
-- AFTER:
--   SELECT  — own rows only
--   INSERT  — own rows only, status must be 'active' (joining only)
--   No UPDATE / DELETE for authenticated role.
--   /api/quest/challenge/complete uses complete_weekly_quest() SECURITY DEFINER
--   for the status→completed transition.

DROP POLICY IF EXISTS "Users can CRUD own user_challenges" ON public.user_challenges;

CREATE POLICY "Users can read own challenges"
  ON public.user_challenges
  FOR SELECT
  USING (auth.uid() = user_id);

-- /api/quest/challenge/accept inserts with status='active'.
-- Block self-insertion of completed/failed rows.
CREATE POLICY "Users can accept challenges (insert active row only)"
  ON public.user_challenges
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'active'
    AND completed_at IS NULL
  );

-- No UPDATE policy: status transitions go through the server route +
-- complete_weekly_quest() SECURITY DEFINER.
-- No DELETE policy.


-- ════════════════════════════════════════════════════════════
-- 4. daily_quest_logs
-- ════════════════════════════════════════════════════════════
-- BEFORE: "Users can CRUD own daily_quest_logs"  FOR ALL  USING (auth.uid() = user_id)
-- AFTER:  SELECT only. complete_daily_quest() SECURITY DEFINER is the sole write path.

DROP POLICY IF EXISTS "Users can CRUD own daily_quest_logs" ON public.daily_quest_logs;

CREATE POLICY "Users can read own daily_quest_logs"
  ON public.daily_quest_logs
  FOR SELECT
  USING (auth.uid() = user_id);

-- No INSERT / UPDATE / DELETE for authenticated role.
-- complete_daily_quest() runs as SECURITY DEFINER and bypasses RLS.


-- ════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES
-- ════════════════════════════════════════════════════════════
-- Run after deploying to confirm the policy surface:
--
-- SELECT tablename, policyname, cmd, qual, with_check
-- FROM pg_policies
-- WHERE tablename IN (
--   'user_achievements',
--   'user_event_participation',
--   'user_challenges',
--   'daily_quest_logs'
-- )
-- ORDER BY tablename, cmd;
--
-- Expected result: no policy with cmd = 'ALL' remains on these tables.
-- Each table should have only SELECT (and INSERT for participation/challenges).
-- ============================================================