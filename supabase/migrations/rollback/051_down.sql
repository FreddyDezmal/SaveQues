-- ─────────────────────────────────────────────────────────────────────────────
-- 051_down.sql
-- Rollback for 051_activity_feed_writes.sql
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_activity_feed(INT, TIMESTAMPTZ);

DROP FUNCTION IF EXISTS public.service_post_level_up(UUID, INTEGER, TEXT);

DROP TRIGGER IF EXISTS trg_feed_on_group_quest_completed ON public.group_quests;
DROP FUNCTION IF EXISTS public.feed_on_group_quest_completed();

DROP TRIGGER IF EXISTS trg_feed_on_group_joined ON public.group_members;
DROP FUNCTION IF EXISTS public.feed_on_group_joined();

DROP TRIGGER IF EXISTS trg_feed_on_streak_milestone ON public.profiles;
DROP FUNCTION IF EXISTS public.feed_on_streak_milestone();

DROP TRIGGER IF EXISTS trg_feed_on_achievement_unlocked ON public.user_achievements;
DROP FUNCTION IF EXISTS public.feed_on_achievement_unlocked();

DROP TRIGGER IF EXISTS trg_feed_on_goal_completed ON public.savings_goals;
DROP FUNCTION IF EXISTS public.feed_on_goal_completed();

DROP FUNCTION IF EXISTS public.post_activity_feed_event(UUID, UUID, TEXT, JSONB, TEXT);

DROP POLICY IF EXISTS "activity_feed_select_by_visibility" ON public.activity_feed;
DROP FUNCTION IF EXISTS public.can_view_activity_row(UUID, UUID, TEXT, UUID);

-- Restore 045's original policies
CREATE POLICY "activity_feed_select_by_visibility"
  ON public.activity_feed FOR SELECT
  USING (
    auth.uid() = actor_id
    OR (visibility = 'public')
    OR (visibility = 'friends' AND public.are_friends(actor_id, auth.uid()))
    OR (
      visibility = 'groups'
      AND group_id IS NOT NULL
      AND public.user_group_role(group_id, auth.uid()) IS NOT NULL
    )
  );

CREATE POLICY "activity_feed_insert_own"
  ON public.activity_feed FOR INSERT
  WITH CHECK (auth.uid() = actor_id);
