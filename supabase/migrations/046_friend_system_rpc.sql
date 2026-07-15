-- ─────────────────────────────────────────────────────────────────────────────
-- 046_friend_system_rpc.sql
-- Sprint 22, Phase 3 — Friend system support
--
-- Two things this migration adds, both required before the /api/friends/*
-- routes can work at all:
--
-- 1. Blocking needs to know WHO blocked whom. `friendships.status='blocked'`
--    alone doesn't say that — added `blocked_by` + a trigger so only the
--    blocking party can undo it.
--
-- 2. public.profiles' SELECT policy is `auth.uid() = id` (014_consolidated_
--    schema.sql) — a user can currently only read their OWN row. That's
--    correct and is NOT changed here. But friend search and a friends list
--    both need to read a few safe fields of OTHER users' profiles. Rather
--    than widen the profiles RLS policy (which would expose is_admin,
--    notification prefs, locale/timezone, internal quest counters to any
--    authenticated user), this adds two SECURITY DEFINER functions that
--    return only an explicit, safe column allowlist and enforce the
--    relationship/visibility rules themselves.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- PART A — Blocking semantics
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.friendships
  ADD COLUMN IF NOT EXISTS blocked_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.friendships
  ADD CONSTRAINT friendships_blocked_by_consistent CHECK (
    (status <> 'blocked' AND blocked_by IS NULL)
    OR (status = 'blocked' AND blocked_by IN (requester_id, addressee_id))
  );

-- ── Two RLS gaps found while designing the /api/friends/* routes below,
-- fixed here as a follow-up rather than rewritten into 045 (which had
-- already been delivered):
--
-- 1. PRIVILEGE ESCALATION: 045's "friendships_insert_own_request" policy
--    only checked `auth.uid() = requester_id` — it never constrained
--    `status`. A client could INSERT a row with status='accepted' directly,
--    creating a "mutual" friendship the other party never consented to.
--    Fixed by restricting insertable status to 'pending' (the normal
--    request flow) or 'blocked' (the block flow, which legitimately skips
--    the pending state).
--
-- 2. BLOCK BYPASS: 045's "friendships_delete_own" policy let either party
--    delete a friendships row regardless of status. Combined with the
--    unconditional unique-pair index, a blocked user could simply DELETE
--    the blocked row themselves and then re-send a request — the trigger
--    above only guards UPDATE, not DELETE. Fixed by only allowing deletion
--    of a 'blocked' row by the party who set blocked_by.
DROP POLICY IF EXISTS "friendships_insert_own_request" ON public.friendships;
CREATE POLICY "friendships_insert_own_request"
  ON public.friendships FOR INSERT
  WITH CHECK (auth.uid() = requester_id AND status IN ('pending', 'blocked'));

DROP POLICY IF EXISTS "friendships_delete_own" ON public.friendships;
CREATE POLICY "friendships_delete_own"
  ON public.friendships FOR DELETE
  USING (
    (auth.uid() = requester_id OR auth.uid() = addressee_id)
    AND (status <> 'blocked' OR auth.uid() = blocked_by)
  );

-- GAP 3, found the same way: the UPDATE policy checked who's allowed to
-- update a row, but not WHICH columns — a party could rewrite
-- requester_id/addressee_id to point the row at an unrelated third user.
-- Locked the same way profiles locks xp_total/streak_days/is_admin in
-- 014_consolidated_schema.sql: WITH CHECK compares the incoming value
-- against the value currently stored for that row.
DROP POLICY IF EXISTS "friendships_update_own" ON public.friendships;
CREATE POLICY "friendships_update_own"
  ON public.friendships FOR UPDATE
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id)
  WITH CHECK (
    (auth.uid() = requester_id OR auth.uid() = addressee_id)
    AND requester_id = (SELECT f2.requester_id FROM public.friendships f2 WHERE f2.id = friendships.id)
    AND addressee_id = (SELECT f2.addressee_id FROM public.friendships f2 WHERE f2.id = friendships.id)
  );

-- Only the blocking party can change a 'blocked' row away from that status
-- (unblock, or nothing else — you can't "accept" your way out of being
-- blocked). blocked_by is stamped automatically from auth.uid(), not
-- trusted from the client payload, and cleared on a legitimate unblock so
-- the row satisfies friendships_blocked_by_consistent afterward.
CREATE OR REPLACE FUNCTION public.enforce_block_ownership()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'blocked' AND (TG_OP = 'INSERT' OR OLD.status <> 'blocked') THEN
    NEW.blocked_by := auth.uid();
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'blocked' AND NEW.status <> 'blocked' THEN
    IF auth.uid() <> OLD.blocked_by THEN
      RAISE EXCEPTION 'Only the user who blocked this relationship can change it'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.blocked_by := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_block_ownership ON public.friendships;
CREATE TRIGGER trg_enforce_block_ownership
  BEFORE INSERT OR UPDATE ON public.friendships
  FOR EACH ROW EXECUTE FUNCTION public.enforce_block_ownership();


-- ═══════════════════════════════════════════════════════════════════════════
-- PART B — Safe profile lookups (does NOT alter profiles RLS)
-- ═══════════════════════════════════════════════════════════════════════════

-- Search by username or display name. Excludes: the caller, anyone with a
-- 'private' profile_visibility, and anyone on either side of a block with
-- the caller (a blocked user shouldn't be able to find the person who
-- blocked them, or re-appear in their search results). Capped at 20 rows —
-- this is a typeahead, not an export.
CREATE OR REPLACE FUNCTION public.search_users(p_query TEXT, p_limit INT DEFAULT 20)
RETURNS TABLE (
  id                UUID,
  username          TEXT,
  display_name      TEXT,
  avatar_emoji      TEXT,
  friendship_status TEXT,   -- 'none' | 'pending_sent' | 'pending_received' | 'accepted'
  friendship_id     UUID
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller UUID := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_query IS NULL OR length(trim(p_query)) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.username,
    p.display_name,
    p.avatar_emoji,
    COALESCE(
      CASE
        WHEN f.status = 'accepted' THEN 'accepted'
        WHEN f.status = 'pending' AND f.requester_id = v_caller THEN 'pending_sent'
        WHEN f.status = 'pending' AND f.addressee_id = v_caller THEN 'pending_received'
        ELSE NULL
      END,
      'none'
    ) AS friendship_status,
    f.id AS friendship_id
  FROM public.profiles p
  LEFT JOIN public.friendships f
    ON f.status IN ('pending', 'accepted')
   AND ((f.requester_id = v_caller AND f.addressee_id = p.id)
     OR (f.requester_id = p.id AND f.addressee_id = v_caller))
  WHERE p.id <> v_caller
    AND p.profile_visibility <> 'private'
    AND (p.username ILIKE '%' || p_query || '%' OR p.display_name ILIKE '%' || p_query || '%')
    -- Exclude anyone on either side of a block with the caller.
    AND NOT EXISTS (
      SELECT 1 FROM public.friendships b
      WHERE b.status = 'blocked'
        AND ((b.requester_id = v_caller AND b.addressee_id = p.id)
          OR (b.requester_id = p.id AND b.addressee_id = v_caller))
    )
  ORDER BY
    (p.username ILIKE p_query || '%') DESC,
    (p.display_name ILIKE p_query || '%') DESC,
    p.display_name ASC
  LIMIT LEAST(p_limit, 20);
END;
$$;

-- Safe profile card for an existing accepted friend (or self). Used by the
-- friends list UI. Deliberately does NOT accept arbitrary user IDs from
-- non-friends — returns NULL rather than partial data if the caller isn't
-- entitled to see this profile, so the API route can turn that into a 404
-- rather than leaking existence via a 403.
CREATE OR REPLACE FUNCTION public.get_friend_profile(p_user_id UUID)
RETURNS TABLE (
  id            UUID,
  username      TEXT,
  display_name  TEXT,
  avatar_emoji  TEXT,
  current_level INTEGER,
  xp_total      INTEGER,
  streak_days   INTEGER,
  longest_streak INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller UUID := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_user_id <> v_caller AND NOT public.are_friends(v_caller, p_user_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.id, p.username, p.display_name, p.avatar_emoji,
         p.current_level, p.xp_total, p.streak_days, p.longest_streak
  FROM public.profiles p
  WHERE p.id = p_user_id;
END;
$$;


-- One round trip for the whole friends page, following the same
-- consolidation rationale as get_dashboard_data() (032_dashboard_rpc.sql):
-- friends list + pending incoming + pending outgoing in a single call
-- instead of the API route making three (or, per-friend-profile, many more).
CREATE OR REPLACE FUNCTION public.list_friends()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_friends JSONB;
  v_incoming JSONB;
  v_outgoing JSONB;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'friendship_id', f.id,
    'since', f.responded_at,
    'id', p.id,
    'username', p.username,
    'display_name', p.display_name,
    'avatar_emoji', p.avatar_emoji,
    'current_level', p.current_level,
    'xp_total', p.xp_total,
    'streak_days', p.streak_days,
    'longest_streak', p.longest_streak
  ) ORDER BY f.responded_at DESC NULLS LAST), '[]'::jsonb)
  INTO v_friends
  FROM public.friendships f
  JOIN public.profiles p
    ON p.id = CASE WHEN f.requester_id = v_caller THEN f.addressee_id ELSE f.requester_id END
  WHERE f.status = 'accepted' AND (f.requester_id = v_caller OR f.addressee_id = v_caller);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'friendship_id', f.id, 'created_at', f.created_at,
    'id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_emoji', p.avatar_emoji
  ) ORDER BY f.created_at DESC), '[]'::jsonb)
  INTO v_incoming
  FROM public.friendships f
  JOIN public.profiles p ON p.id = f.requester_id
  WHERE f.status = 'pending' AND f.addressee_id = v_caller;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'friendship_id', f.id, 'created_at', f.created_at,
    'id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_emoji', p.avatar_emoji
  ) ORDER BY f.created_at DESC), '[]'::jsonb)
  INTO v_outgoing
  FROM public.friendships f
  JOIN public.profiles p ON p.id = f.addressee_id
  WHERE f.status = 'pending' AND f.requester_id = v_caller;

  RETURN jsonb_build_object('friends', v_friends, 'pending_incoming', v_incoming, 'pending_outgoing', v_outgoing);
END;
$$;
