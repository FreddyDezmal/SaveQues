-- ─────────────────────────────────────────────────────────────────────────────
-- 054_privacy_system.sql
-- Sprint 22, Phase 12 — Privacy system
--
-- This phase is primarily an AUDIT (see PRIVACY_AUDIT.md, delivered
-- alongside this migration, for the full endpoint-by-endpoint review of
-- everything built in Phases 2–11). This migration is the small amount of
-- genuinely new surface the audit found missing — not a rewrite of
-- anything, consistent with how every visibility column and its
-- enforcement was already designed incrementally as each feature needed
-- it (profiles.profile_visibility/activity_visibility and savings_goals.
-- goal_visibility in 045, user_achievements.visibility in 045, all
-- enforced in 051's activity feed triggers).
--
-- Two real gaps found:
--
-- 1. 'groups' is a legal value for activity_visibility (045's CHECK
--    constraint) and is used correctly by activity_feed (051, via
--    can_view_activity_row checking group_id + user_group_role). But
--    nothing resolves "groups" visibility for content that ISN'T scoped
--    to one specific group_id — an achievement, for instance, has no
--    natural group_id of its own. "Visible to anyone I share a group
--    with, whichever group that is" needs its own check, which didn't
--    exist. Added: share_any_group().
--
-- 2. Achievements only ever surfaced once, transiently, in the activity
--    feed at the moment they were unlocked (051's feed_on_achievement_
--    unlocked trigger). There was no way to actually BROWSE a user's
--    achievements respecting their per-achievement visibility — the
--    brief explicitly lists "Public achievements" as a visibility level,
--    which implies something browsable, not just a single feed post that
--    scrolls away. Added: get_user_achievements().
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- PART A.1 — user_achievements.visibility was missing 'groups'
-- ═══════════════════════════════════════════════════════════════════════════
-- Found while testing get_user_achievements() below: its CASE handles a
-- per-achievement 'groups' override (falling back to activity_visibility
-- otherwise), but 045's CHECK constraint only ever allowed
-- ('private','friends','public') for an explicit override — 'groups' was
-- reachable only via the profile-level fallback, never settable directly
-- on a specific achievement. Since "Groups only" is an explicit
-- visibility level the brief calls for, and activity_visibility already
-- supports it, this closes that inconsistency rather than leaving
-- get_user_achievements() handling a case that could never occur through
-- an explicit override.

ALTER TABLE public.user_achievements DROP CONSTRAINT IF EXISTS user_achievements_visibility_check;
ALTER TABLE public.user_achievements ADD CONSTRAINT user_achievements_visibility_check
  CHECK (visibility IS NULL OR visibility IN ('private', 'friends', 'groups', 'public'));


-- ═══════════════════════════════════════════════════════════════════════════
-- PART A — share_any_group() helper
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.share_any_group(p_user_a UUID, p_user_b UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members gm_a
    JOIN public.group_members gm_b
      ON gm_b.group_id = gm_a.group_id AND gm_b.status = 'active'
    WHERE gm_a.user_id = p_user_a AND gm_a.status = 'active' AND gm_b.user_id = p_user_b
  );
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART B — get_user_achievements(): the browsable, visibility-respecting
-- read path "Public achievements" implies but didn't exist yet
-- ═══════════════════════════════════════════════════════════════════════════
-- Two layers, both enforced, neither assumed:
--   1. profiles.profile_visibility is the OUTER gate, for STRANGERS only —
--      someone with no established friendship or shared group with the
--      target. It doesn't retroactively hide a user from people they're
--      already connected to (removing a friendship/leaving a group is
--      the explicit action for that); this matches get_friend_profile()
--      (046), which never re-checks profile_visibility for an accepted
--      friend. My first draft got this wrong — blocked everyone
--      including existing friends — and testing this function against
--      get_friend_profile's already-established behavior is what caught
--      the inconsistency, not a design review.
--   2. Per-achievement visibility (user_achievements.visibility, falling
--      back to profiles.activity_visibility, same as 051's feed trigger)
--      is the INNER gate — private/friends/groups/public per item.
-- Returns an empty list rather than NULL/error for a profile that exists
-- but is fully private to this caller, so the route can't be used to
-- distinguish "no achievements" from "not allowed to see them."

CREATE OR REPLACE FUNCTION public.get_user_achievements(p_target_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller   UUID := auth.uid();
  v_profile  RECORD;
  v_is_self  BOOLEAN;
  v_is_friend BOOLEAN;
  v_shares_group BOOLEAN;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT profile_visibility, activity_visibility INTO v_profile
  FROM public.profiles WHERE id = p_target_user_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_is_self := (p_target_user_id = v_caller);
  v_is_friend := v_is_self OR public.are_friends(p_target_user_id, v_caller);
  v_shares_group := v_is_self OR public.share_any_group(p_target_user_id, v_caller);

  -- profile_visibility='private' gates STRANGERS only — someone with no
  -- established relationship to the target at all. An existing friend or
  -- fellow group member keeps their own relationship-based access; this
  -- setting isn't a way to retroactively hide from people you're already
  -- connected to (that's what removing the friendship/leaving the group
  -- is for). Matches get_friend_profile() (046), which already doesn't
  -- re-check profile_visibility for an accepted friend — found this
  -- inconsistency by testing this function against that one, not by
  -- inspection; my first draft blocked everyone including friends, which
  -- would have made the same person's data behave under two different
  -- privacy rules depending only on which endpoint you asked.
  IF NOT v_is_self AND NOT v_is_friend AND NOT v_shares_group AND v_profile.profile_visibility = 'private' THEN
    RETURN jsonb_build_object('user_id', p_target_user_id, 'achievements', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'user_id', p_target_user_id,
    'achievements', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'achievement_id', ua.achievement_id,
        'earned_at', ua.earned_at
      ) ORDER BY ua.earned_at DESC), '[]'::jsonb)
      FROM public.user_achievements ua
      WHERE ua.user_id = p_target_user_id
        AND (
          v_is_self
          OR COALESCE(ua.visibility, v_profile.activity_visibility) = 'public'
          OR (COALESCE(ua.visibility, v_profile.activity_visibility) = 'friends' AND v_is_friend)
          OR (COALESCE(ua.visibility, v_profile.activity_visibility) = 'groups' AND v_shares_group)
        )
    )
  );
END;
$$;
