-- 041_down.sql
-- Rollback for 041_user_weekly_quests_rls_lockdown.sql
--
-- CAUTION: rolling this back reopens the direct-client-write bypass
-- described in 041's header comment — a user could once again set their
-- own user_weekly_quests.status = 'completed' with an arbitrary xp_earned
-- via a direct client update. Only roll back if 041 is found to be
-- blocking a legitimate write path that was missed.

DROP POLICY IF EXISTS "Users can read own weekly quests" ON public.user_weekly_quests;
DROP POLICY IF EXISTS "Users can accept weekly quests (insert active row only)" ON public.user_weekly_quests;
DROP POLICY IF EXISTS "Users can re-accept weekly quests while still active" ON public.user_weekly_quests;

CREATE POLICY "Users can CRUD own user_weekly_quests"
  ON public.user_weekly_quests
  FOR ALL
  USING (auth.uid() = user_id);
