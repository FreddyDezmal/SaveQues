-- 041_user_weekly_quests_rls_lockdown.sql
--
-- Admin CRUD audit finding (docs/ADMIN_CRUD_AUDIT.md): unlike
-- daily_quest_logs and user_challenges (locked down in migration 019),
-- public.user_weekly_quests was left with its original
-- "FOR ALL USING (auth.uid() = user_id)" policy. That means any
-- authenticated client could directly:
--   supabase.from("user_weekly_quests").update({ status: "completed",
--     xp_earned: 999999 }).eq("id", myRowId)
-- and it would succeed — completely bypassing complete_weekly_quest()
-- (the SECURITY DEFINER function that verifies XP server-side) and the
-- requirement_type/requirement_value checks added in migration 038 /
-- app/api/quest/weekly/complete/route.ts. This is a more severe version
-- of the same class of gap fixed for user_challenges in migration 019 —
-- there, the missing UPDATE policy caused the *legitimate* route to
-- silently no-op (a data-integrity bug); here, the *present* permissive
-- policy would let a malicious client actually succeed.
--
-- Write paths after this migration:
--   INSERT — app/api/quest/weekly/accept/route.ts (own row, status='active' only)
--   UPDATE — app/api/quest/weekly/accept/route.ts's upsert re-accept path
--            (own row, must currently be 'active', must stay 'active' —
--            cannot be used to set status='completed')
--          — complete_weekly_quest() SECURITY DEFINER (bypasses RLS
--            entirely, unaffected by this policy change) is the only path
--            that can ever set status='completed'.

DROP POLICY IF EXISTS "Users can CRUD own user_weekly_quests" ON public.user_weekly_quests;

CREATE POLICY "Users can read own weekly quests"
  ON public.user_weekly_quests
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can accept weekly quests (insert active row only)"
  ON public.user_weekly_quests
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'active'
    AND completed_at IS NULL
  );

CREATE POLICY "Users can re-accept weekly quests while still active"
  ON public.user_weekly_quests
  FOR UPDATE
  USING (
    auth.uid() = user_id
    AND status = 'active'          -- cannot touch an already-completed row via this policy
  )
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'active'          -- the resulting row must still be 'active' — cannot flip to 'completed' this way
    AND completed_at IS NULL
  );

-- No DELETE policy for authenticated — matches the pattern for the other
-- locked-down gamification tables (daily_quest_logs, user_challenges,
-- user_achievements, user_event_participation).
