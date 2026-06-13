-- ============================================================
-- SaveQuest Migration 010 — profiles RLS Security Hardening
-- ============================================================
-- Replaces the permissive "Users can update own profile" policy
-- with one that blocks direct writes to system-managed columns
-- from the browser, while preserving the ability to update safe
-- preference columns (display_name, avatar_emoji, locale, etc.).
--
-- Depends on: 001 (profiles table + original UPDATE policy)
-- Required by: nothing — standalone security layer
-- ============================================================

-- ── DROP OLD PERMISSIVE POLICY ────────────────────────────────
-- The original policy allowed any authenticated user to UPDATE
-- any column on their own profile row, including xp_total,
-- streak_days, and is_admin.
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;


-- ── HARDENED UPDATE POLICY ────────────────────────────────────
-- USING  → who may attempt an update  (must own the row)
-- WITH CHECK → what the resulting row may look like
--
-- The WITH CHECK subselects read the CURRENT row values before
-- the update is applied, so they catch any attempt to change a
-- protected column regardless of what the caller submits.
--
-- Protected columns (must remain unchanged by browser writes):
--   xp_total                — managed exclusively by award_xp()
--   streak_days             — managed exclusively by update_streak()
--   is_admin                — set only via SQL editor / admin tooling
--   daily_quests_completed  — incremented by complete_daily_quest()
--   weekly_quests_completed — incremented by complete_weekly_quest()
--   quest_chains_completed  — incremented by complete_chain_step()
--
-- Safe columns users may still update freely:
--   display_name, avatar_emoji, currency_code, locale,
--   country_code, last_notification_hour, streak_paused_until
CREATE POLICY "Users can update own profile (safe columns only)"
  ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id

    AND xp_total = (
      SELECT xp_total FROM public.profiles WHERE id = auth.uid()
    )
    AND streak_days = (
      SELECT streak_days FROM public.profiles WHERE id = auth.uid()
    )
    AND is_admin = (
      SELECT is_admin FROM public.profiles WHERE id = auth.uid()
    )
    AND daily_quests_completed = (
      SELECT daily_quests_completed FROM public.profiles WHERE id = auth.uid()
    )
    AND weekly_quests_completed = (
      SELECT weekly_quests_completed FROM public.profiles WHERE id = auth.uid()
    )
    AND quest_chains_completed = (
      SELECT quest_chains_completed FROM public.profiles WHERE id = auth.uid()
    )
  );


-- ── VERIFICATION QUERY (run manually after applying) ─────────
-- Confirm the old policy is gone and the new one is present:
--
--   SELECT policyname, cmd, qual, with_check
--   FROM pg_policies
--   WHERE tablename = 'profiles'
--   ORDER BY policyname;
--
-- Expected: no row named "Users can update own profile",
--           one row named "Users can update own profile (safe columns only)"
