-- ─────────────────────────────────────────────────────────────────────────────
-- 051_activity_feed_writes.sql
-- Sprint 22, Phase 8 — Social feed
--
-- 045 created activity_feed with RLS but deliberately left the write path
-- for Phase 8: "Write path (inserting rows when events happen) is Phase 8
-- application logic... not built in this migration." This is that logic.
--
-- ── Design decision: no client-side "post to feed" at all ────────────────
-- 045 included an "activity_feed_insert_own" policy (auth.uid() = actor_id)
-- for authenticated users to insert their own rows directly. Looking at
-- the brief's own examples — "John completed a goal", "Sarah reached
-- Level 8", "Mike unlocked an achievement" — every one of these is a
-- system-observed fact, not a user-authored post. The event_type CHECK
-- constraint only restricts which STRING values are legal; it does
-- nothing to stop a user inserting achievement_unlocked with an
-- achievement_id they never actually earned. A feed whose entries can be
-- fabricated by the person they're about isn't worth building. This
-- migration DROPS that policy — every row now comes either from a
-- SECURITY DEFINER trigger reacting to a real state change (bypasses RLS
-- by table ownership, same as every other trigger this sprint) or from
-- server-side application code using the service-role client. No
-- authenticated client can INSERT into activity_feed at all after this.
--
-- ── Finding: current_level is never written anywhere in this schema ──────
-- I looked for what should update profiles.current_level so a level_up
-- trigger could watch it the same way streak_milestone watches
-- streak_days. It's never set — not by award_xp(), not by any migration,
-- not anywhere in app/ or lib/. Level is computed purely on the fly by
-- lib/awardXP.ts's getLevelFromXP(xp_total) at the two places
-- (app/api/transactions/route.ts, app/api/quest/daily/complete/route.ts)
-- that already call detectLevelUp() for analytics. There is nothing for a
-- database trigger to watch. Rather than invent a leveling formula and a
-- current_level-writing trigger with no evidence either belongs in this
-- codebase, level_up is posted from application code (see the accompanying
-- lib/activityFeed.ts and the two route edits) at the exact point
-- detectLevelUp() already fires — reusing the existing detection, not
-- adding a second one.
--
-- ── Also flagging, not fixing (out of Phase 8 scope) ──────────────────────
-- user_achievements' original policy (014) is `FOR ALL USING (auth.uid() =
-- user_id)` — broader than an insert-only self-service policy would be; a
-- user can insert their own user_achievements row directly, bypassing
-- award_achievement(). That predates this sprint and touching it isn't a
-- "social feed" change, so it's untouched here — but it does mean
-- achievement_unlocked feed entries inherit whatever trust level the
-- underlying table already has. Worth knowing, not guessed away.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- PART A — Lock down direct inserts; add the shared write helper
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "activity_feed_insert_own" ON public.activity_feed;

-- Single source of truth for "can this viewer see this row" — used by
-- BOTH the RLS policy (recreated below) and get_activity_feed (PART H).
-- Duplicating this logic in two places (a raw RLS USING clause and a raw
-- WHERE clause in the RPC) is exactly the kind of thing that quietly
-- drifts apart over time; this sprint already hit a real bug from that
-- shape once (shared_goals/shared_goal_members mutual RLS recursion, 045)
-- and it's cheap to just not repeat it.
CREATE OR REPLACE FUNCTION public.can_view_activity_row(
  p_actor_id   UUID,
  p_group_id   UUID,
  p_visibility TEXT,
  p_viewer_id  UUID
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    p_actor_id = p_viewer_id
    OR p_visibility = 'public'
    OR (p_visibility = 'friends' AND public.are_friends(p_actor_id, p_viewer_id))
    OR (p_visibility = 'groups' AND p_group_id IS NOT NULL AND public.user_group_role(p_group_id, p_viewer_id) IS NOT NULL);
$$;

DROP POLICY IF EXISTS "activity_feed_select_by_visibility" ON public.activity_feed;
CREATE POLICY "activity_feed_select_by_visibility"
  ON public.activity_feed FOR SELECT
  USING (public.can_view_activity_row(actor_id, group_id, visibility, auth.uid()));

-- Internal only — not granted to authenticated. Every trigger below, and
-- the service-role level_up path, calls this instead of inserting
-- directly, so there is exactly one place that enforces the shape of a
-- feed row (and, implicitly, benefits from the activity_feed_no_
-- financial_fields CHECK constraint from 045 either way).
CREATE OR REPLACE FUNCTION public.post_activity_feed_event(
  p_actor_id   UUID,
  p_group_id   UUID,
  p_event_type TEXT,
  p_metadata   JSONB,
  p_visibility TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.activity_feed (actor_id, group_id, event_type, metadata, visibility)
  VALUES (p_actor_id, p_group_id, p_event_type, COALESCE(p_metadata, '{}'::jsonb), COALESCE(p_visibility, 'friends'));
END;
$$;

REVOKE ALL ON FUNCTION public.post_activity_feed_event(UUID, UUID, TEXT, JSONB, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.post_activity_feed_event(UUID, UUID, TEXT, JSONB, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.post_activity_feed_event(UUID, UUID, TEXT, JSONB, TEXT) TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART B — goal_completed
-- ═══════════════════════════════════════════════════════════════════════════
-- Visibility follows savings_goals.goal_visibility (045). 'group' maps to
-- activity_feed's 'groups' and requires the goal to actually be attached
-- to one via shared_goals — if goal_visibility says 'group' but the goal
-- isn't shared to any group (a stale setting), this falls back to
-- 'private' rather than guessing which group was meant.

CREATE OR REPLACE FUNCTION public.feed_on_goal_completed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_visibility TEXT;
  v_group_id   UUID;
BEGIN
  v_visibility := CASE NEW.goal_visibility WHEN 'group' THEN 'groups' ELSE NEW.goal_visibility END;

  IF NEW.goal_visibility = 'group' THEN
    SELECT sg.group_id INTO v_group_id FROM public.shared_goals sg WHERE sg.goal_id = NEW.id;
    IF v_group_id IS NULL THEN
      v_visibility := 'private';
    END IF;
  END IF;

  PERFORM public.post_activity_feed_event(
    NEW.user_id, v_group_id, 'goal_completed',
    jsonb_build_object('goal_title', NEW.title, 'goal_emoji', NEW.goal_emoji),
    v_visibility
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feed_on_goal_completed ON public.savings_goals;
CREATE TRIGGER trg_feed_on_goal_completed
  AFTER UPDATE OF is_complete ON public.savings_goals
  FOR EACH ROW
  WHEN (NEW.is_complete = TRUE AND OLD.is_complete IS DISTINCT FROM TRUE)
  EXECUTE FUNCTION public.feed_on_goal_completed();


-- ═══════════════════════════════════════════════════════════════════════════
-- PART C — achievement_unlocked
-- ═══════════════════════════════════════════════════════════════════════════
-- achievement_id is a bare TEXT code (014) — there's no achievement
-- catalog table in the DB with display names, so metadata carries the
-- code only. Display name/icon resolution is client-side via the
-- existing lib/achievements.ts catalog, same as every other place
-- achievement_id is already used in this codebase — not something new
-- this migration needs to solve.

CREATE OR REPLACE FUNCTION public.feed_on_achievement_unlocked()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_visibility TEXT;
BEGIN
  SELECT COALESCE(NEW.visibility, p.activity_visibility) INTO v_visibility
  FROM public.profiles p WHERE p.id = NEW.user_id;

  PERFORM public.post_activity_feed_event(
    NEW.user_id, NULL, 'achievement_unlocked',
    jsonb_build_object('achievement_id', NEW.achievement_id),
    COALESCE(v_visibility, 'friends')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feed_on_achievement_unlocked ON public.user_achievements;
CREATE TRIGGER trg_feed_on_achievement_unlocked
  AFTER INSERT ON public.user_achievements
  FOR EACH ROW EXECUTE FUNCTION public.feed_on_achievement_unlocked();


-- ═══════════════════════════════════════════════════════════════════════════
-- PART D — streak_milestone
-- ═══════════════════════════════════════════════════════════════════════════
-- Fires once per threshold crossed, using the HIGHEST threshold crossed
-- in a single update (e.g. a streak-shield-driven jump that crosses two
-- thresholds at once posts one entry, not two). Only fires on an
-- increase — a streak reset (streak_days dropping) never posts.

CREATE OR REPLACE FUNCTION public.feed_on_streak_milestone()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_thresholds INT[] := ARRAY[7, 14, 30, 50, 100, 200, 365, 500, 1000];
  v_milestone  INT := NULL;
  t            INT;
BEGIN
  IF NEW.streak_days <= OLD.streak_days THEN
    RETURN NEW;
  END IF;

  FOREACH t IN ARRAY v_thresholds LOOP
    IF OLD.streak_days < t AND NEW.streak_days >= t THEN
      v_milestone := t;
    END IF;
  END LOOP;

  IF v_milestone IS NOT NULL THEN
    PERFORM public.post_activity_feed_event(
      NEW.id, NULL, 'streak_milestone',
      jsonb_build_object('streak_days', v_milestone),
      NEW.activity_visibility
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feed_on_streak_milestone ON public.profiles;
CREATE TRIGGER trg_feed_on_streak_milestone
  AFTER UPDATE OF streak_days ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.feed_on_streak_milestone();


-- ═══════════════════════════════════════════════════════════════════════════
-- PART E — group_joined
-- ═══════════════════════════════════════════════════════════════════════════
-- Fires for the initial owner auto-seed (045's on_group_created trigger
-- inserts status='active' directly) and for invite-accept /
-- join-approve transitions to 'active'. Actor is whoever joined
-- (NEW.user_id) — not whoever approved a join request, if that's how it
-- happened. Scoped to 'groups' visibility for that specific group only.

CREATE OR REPLACE FUNCTION public.feed_on_group_joined()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_group_name TEXT;
BEGIN
  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status <> 'active') THEN
    SELECT name INTO v_group_name FROM public.groups WHERE id = NEW.group_id;
    PERFORM public.post_activity_feed_event(
      NEW.user_id, NEW.group_id, 'group_joined',
      jsonb_build_object('group_name', v_group_name),
      'groups'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feed_on_group_joined ON public.group_members;
CREATE TRIGGER trg_feed_on_group_joined
  AFTER INSERT OR UPDATE OF status ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.feed_on_group_joined();


-- ═══════════════════════════════════════════════════════════════════════════
-- PART F — group_quest_completed
-- ═══════════════════════════════════════════════════════════════════════════
-- Fires automatically off service_complete_group_quest's (050) status
-- update — no changes needed to that function at all, this is pure
-- trigger composition. There's no single natural "actor" for a group
-- achievement (activity_feed.actor_id is NOT NULL and references one
-- profile); the group's owner is used as the attributed actor, which is
-- a deliberate simplification worth knowing about, not an arbitrary
-- unstated choice.

CREATE OR REPLACE FUNCTION public.feed_on_group_quest_completed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner_id UUID;
BEGIN
  IF NEW.status = 'completed' AND OLD.status <> 'completed' THEN
    SELECT owner_id INTO v_owner_id FROM public.groups WHERE id = NEW.group_id;
    PERFORM public.post_activity_feed_event(
      v_owner_id, NEW.group_id, 'group_quest_completed',
      jsonb_build_object('quest_title', NEW.title),
      'groups'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feed_on_group_quest_completed ON public.group_quests;
CREATE TRIGGER trg_feed_on_group_quest_completed
  AFTER UPDATE OF status ON public.group_quests
  FOR EACH ROW EXECUTE FUNCTION public.feed_on_group_quest_completed();


-- ═══════════════════════════════════════════════════════════════════════════
-- PART G — level_up: service-role-only insert path (see file header)
-- ═══════════════════════════════════════════════════════════════════════════
-- No trigger — there's nothing to watch. Called from application code
-- (lib/activityFeed.ts) using the service-role client, at the two
-- existing detectLevelUp() call sites. Locked to service_role for the
-- same reason as 050's completion function: this needs to be reachable
-- only from trusted server code, not any authenticated browser session.

CREATE OR REPLACE FUNCTION public.service_post_level_up(
  p_user_id   UUID,
  p_new_level INTEGER,
  p_new_title TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_visibility TEXT;
BEGIN
  SELECT activity_visibility INTO v_visibility FROM public.profiles WHERE id = p_user_id;
  PERFORM public.post_activity_feed_event(
    p_user_id, NULL, 'level_up',
    jsonb_build_object('new_level', p_new_level, 'new_title', p_new_title),
    COALESCE(v_visibility, 'friends')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.service_post_level_up(UUID, INTEGER, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.service_post_level_up(UUID, INTEGER, TEXT) FROM authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART H — Read RPC
-- ═══════════════════════════════════════════════════════════════════════════
-- activity_feed's own SELECT RLS (045, unchanged) already restricts which
-- rows a caller can see. This RPC exists only to join in the actor's safe
-- profile card, since profiles stays locked to auth.uid() = id and a
-- plain client-side join can't reach other actors' names/avatars — same
-- reason every other feed/list RPC this sprint needed one.
CREATE OR REPLACE FUNCTION public.get_activity_feed(p_limit INT DEFAULT 30, p_before TIMESTAMPTZ DEFAULT NULL)
RETURNS TABLE (
  id           UUID,
  actor_id     UUID,
  actor_username TEXT,
  actor_display_name TEXT,
  actor_avatar_emoji TEXT,
  group_id     UUID,
  group_name   TEXT,
  event_type   TEXT,
  metadata     JSONB,
  visibility   TEXT,
  created_at   TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller UUID := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT af.id, af.actor_id, p.username, p.display_name, p.avatar_emoji,
         af.group_id, g.name, af.event_type, af.metadata, af.visibility, af.created_at
  FROM public.activity_feed af
  JOIN public.profiles p ON p.id = af.actor_id
  LEFT JOIN public.groups g ON g.id = af.group_id
  WHERE public.can_view_activity_row(af.actor_id, af.group_id, af.visibility, v_caller)
    AND (p_before IS NULL OR af.created_at < p_before)
  ORDER BY af.created_at DESC
  LIMIT LEAST(COALESCE(p_limit, 30), 50);
END;
$$;
