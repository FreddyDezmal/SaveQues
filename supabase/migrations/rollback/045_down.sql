-- ─────────────────────────────────────────────────────────────────────────────
-- 045_down.sql
-- Rollback for 045_social_foundation.sql
--
-- Drops in reverse dependency order. Extending-column changes to
-- profiles/savings_goals/user_achievements are reverted last since nothing
-- in this migration made those columns NOT NULL, so leaving them isn't
-- destructive if this rollback is only run partially.
-- ─────────────────────────────────────────────────────────────────────────────

-- Part H
DROP FUNCTION IF EXISTS public.increment_group_xp(UUID, INTEGER);

-- Part G
DROP POLICY IF EXISTS "activity_feed_delete_own"          ON public.activity_feed;
DROP POLICY IF EXISTS "activity_feed_insert_own"           ON public.activity_feed;
DROP POLICY IF EXISTS "activity_feed_select_by_visibility" ON public.activity_feed;
DROP TABLE IF EXISTS public.activity_feed;

-- Part F
DROP POLICY IF EXISTS "group_quests_update_owner_or_admin" ON public.group_quests;
DROP POLICY IF EXISTS "group_quests_insert_owner_or_admin" ON public.group_quests;
DROP POLICY IF EXISTS "group_quests_select_member"         ON public.group_quests;
DROP TABLE IF EXISTS public.group_quests;

-- Part E
DROP TABLE IF EXISTS public.group_contributions;
DROP TRIGGER IF EXISTS trg_enforce_contribution_membership ON public.group_contributions;
DROP FUNCTION IF EXISTS public.enforce_contribution_membership();

DROP POLICY IF EXISTS "shared_goal_members_update_self_or_owner"   ON public.shared_goal_members;
DROP POLICY IF EXISTS "shared_goal_members_insert_owner_invites"   ON public.shared_goal_members;
DROP POLICY IF EXISTS "shared_goal_members_select_participant"     ON public.shared_goal_members;
DROP TABLE IF EXISTS public.shared_goal_members;

DROP TRIGGER IF EXISTS trg_enforce_shared_goal_ownership ON public.shared_goals;
DROP FUNCTION IF EXISTS public.enforce_shared_goal_ownership();
DROP FUNCTION IF EXISTS public.can_view_shared_goal(UUID, UUID);
DROP POLICY IF EXISTS "shared_goals_delete_owner_only"       ON public.shared_goals;
DROP POLICY IF EXISTS "shared_goals_update_owner_only"       ON public.shared_goals;
DROP POLICY IF EXISTS "shared_goals_insert_owner_only"       ON public.shared_goals;
DROP POLICY IF EXISTS "shared_goals_select_owner_or_member"  ON public.shared_goals;
DROP TABLE IF EXISTS public.shared_goals;

-- Part D
DROP POLICY IF EXISTS "group_members_delete_self_or_admin"            ON public.group_members;
DROP POLICY IF EXISTS "group_members_update_self_or_admin"            ON public.group_members;
DROP POLICY IF EXISTS "group_members_insert_invite_or_self_request"   ON public.group_members;
DROP POLICY IF EXISTS "group_members_select_fellow_members"           ON public.group_members;
DROP TABLE IF EXISTS public.group_members;

DROP POLICY IF EXISTS "groups_delete_owner_only"          ON public.groups;
DROP POLICY IF EXISTS "groups_update_owner_or_admin"       ON public.groups;
DROP POLICY IF EXISTS "groups_insert_as_owner"             ON public.groups;
DROP POLICY IF EXISTS "groups_select_member_or_owner"      ON public.groups;
DROP TRIGGER IF EXISTS on_group_created ON public.groups;
DROP FUNCTION IF EXISTS public.handle_new_group();
DROP TABLE IF EXISTS public.groups;

DROP FUNCTION IF EXISTS public.user_group_role(UUID, UUID);

-- Part C
DROP TRIGGER IF EXISTS trg_enforce_single_accountability_partner ON public.accountability_partners;
DROP FUNCTION IF EXISTS public.enforce_single_accountability_partner();
DROP POLICY IF EXISTS "accountability_update_own"           ON public.accountability_partners;
DROP POLICY IF EXISTS "accountability_insert_own_request"   ON public.accountability_partners;
DROP POLICY IF EXISTS "accountability_select_own"            ON public.accountability_partners;
DROP TABLE IF EXISTS public.accountability_partners;

-- Part B
DROP FUNCTION IF EXISTS public.are_friends(UUID, UUID);
DROP POLICY IF EXISTS "friendships_delete_own"              ON public.friendships;
DROP POLICY IF EXISTS "friendships_update_own"               ON public.friendships;
DROP POLICY IF EXISTS "friendships_insert_own_request"       ON public.friendships;
DROP POLICY IF EXISTS "friendships_select_own"                ON public.friendships;
DROP TABLE IF EXISTS public.friendships;

-- Part A — column extensions
ALTER TABLE public.user_achievements DROP COLUMN IF EXISTS visibility;
ALTER TABLE public.savings_goals     DROP COLUMN IF EXISTS goal_visibility;
DROP INDEX IF EXISTS profiles_username_unique;
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS activity_visibility,
  DROP COLUMN IF EXISTS profile_visibility,
  DROP COLUMN IF EXISTS username;
