-- ─────────────────────────────────────────────────────────────────────────────
-- 048_group_hardening_rpc.sql
-- Sprint 22, Phase 5 — Savings groups
--
-- Same audit performed on friendships (046) and accountability_partners
-- (047), applied to groups/group_members before building routes on top of
-- them. Two real gaps found:
--
-- 1. groups_update_owner_or_admin (045) let an ADMIN change owner_id —
--    an admin could set owner_id = themselves via a plain UPDATE, silently
--    stealing the group from its actual owner. Locked owner_id immutable;
--    ownership transfer isn't built in this pass (flagged, not guessed at).
--
-- 2. group_members_update_self_or_admin (045) let a member update their
--    OWN row's `role` column with no restriction — a regular member could
--    UPDATE their own group_members row to role='admin' and self-promote.
--    Locked so only the group owner can change anyone's role, mirroring
--    how 047 centralized accountability_partners' transition rules in one
--    trigger rather than leaving them to whatever each RLS clause happened
--    to allow.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- PART A — Lock groups.owner_id
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "groups_update_owner_or_admin" ON public.groups;
CREATE POLICY "groups_update_owner_or_admin"
  ON public.groups FOR UPDATE
  USING (auth.uid() = owner_id OR public.user_group_role(id, auth.uid()) = 'admin')
  WITH CHECK (
    (auth.uid() = owner_id OR public.user_group_role(id, auth.uid()) = 'admin')
    AND owner_id = (SELECT g2.owner_id FROM public.groups g2 WHERE g2.id = groups.id)
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- PART B — group_members: role/status transition trigger
-- ═══════════════════════════════════════════════════════════════════════════

-- Simplified to "you're entitled to touch this row" — the trigger below
-- owns which specific transitions are valid and who may make them, the
-- same split 047 used for accountability_partners.
DROP POLICY IF EXISTS "group_members_update_self_or_admin" ON public.group_members;
CREATE POLICY "group_members_update_self_or_admin"
  ON public.group_members FOR UPDATE
  USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.groups WHERE id = group_id AND owner_id = auth.uid())
    OR public.user_group_role(group_id, auth.uid()) = 'admin'
  )
  WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.groups WHERE id = group_id AND owner_id = auth.uid())
    OR public.user_group_role(group_id, auth.uid()) = 'admin'
  );

CREATE OR REPLACE FUNCTION public.enforce_group_member_transition()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner_id UUID;
BEGIN
  IF NEW.group_id <> OLD.group_id OR NEW.user_id <> OLD.user_id THEN
    RAISE EXCEPTION 'group_id/user_id cannot be changed after creation'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT owner_id INTO v_owner_id FROM public.groups WHERE id = NEW.group_id;

  -- The owner's own row is immutable through this path entirely — no role
  -- change, no status change. Ownership transfer / group deletion are the
  -- only ways that row moves, and neither goes through this trigger.
  IF OLD.role = 'owner' THEN
    RAISE EXCEPTION 'The group owner''s membership row cannot be modified here'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Role changes: owner-only, and never TO 'owner' (that would create a
  -- second owner row, which nothing else in this schema expects).
  IF NEW.role <> OLD.role THEN
    IF auth.uid() <> v_owner_id THEN
      RAISE EXCEPTION 'Only the group owner can change member roles'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.role = 'owner' THEN
      RAISE EXCEPTION 'Cannot promote a member to owner'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END IF;

  IF NEW.status <> OLD.status THEN
    IF OLD.status = 'invited' AND NEW.status = 'active' THEN
      IF auth.uid() <> OLD.user_id THEN
        RAISE EXCEPTION 'Only the invited user can accept this invite'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      NEW.responded_at := COALESCE(NEW.responded_at, NOW());

    ELSIF OLD.status = 'invited' AND NEW.status = 'declined' THEN
      IF auth.uid() <> OLD.user_id AND auth.uid() <> v_owner_id
         AND public.user_group_role(NEW.group_id, auth.uid()) <> 'admin' THEN
        RAISE EXCEPTION 'Not allowed to decline this invite'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      NEW.responded_at := COALESCE(NEW.responded_at, NOW());

    ELSIF OLD.status = 'pending_approval' AND NEW.status = 'active' THEN
      IF auth.uid() <> v_owner_id AND public.user_group_role(NEW.group_id, auth.uid()) <> 'admin' THEN
        RAISE EXCEPTION 'Only the owner or an admin can approve a join request'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      NEW.responded_at := COALESCE(NEW.responded_at, NOW());

    ELSIF OLD.status = 'pending_approval' AND NEW.status = 'declined' THEN
      IF auth.uid() <> OLD.user_id AND auth.uid() <> v_owner_id
         AND public.user_group_role(NEW.group_id, auth.uid()) <> 'admin' THEN
        RAISE EXCEPTION 'Not allowed to decline this join request'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      NEW.responded_at := COALESCE(NEW.responded_at, NOW());

    ELSIF OLD.status = 'active' AND NEW.status = 'removed' THEN
      -- Self-leave, or owner/admin removing someone else.
      IF auth.uid() <> OLD.user_id AND auth.uid() <> v_owner_id
         AND public.user_group_role(NEW.group_id, auth.uid()) <> 'admin' THEN
        RAISE EXCEPTION 'Not allowed to remove this member'
          USING ERRCODE = 'insufficient_privilege';
      END IF;

    ELSE
      RAISE EXCEPTION 'Invalid group_members transition: % -> %', OLD.status, NEW.status
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_group_member_transition ON public.group_members;
CREATE TRIGGER trg_enforce_group_member_transition
  BEFORE UPDATE ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_group_member_transition();

-- Same owner-row protection as the UPDATE trigger above, applied to
-- DELETE: an admin could otherwise delete the owner's own group_members
-- row directly (045's policy allowed it — owner_id = auth.uid() is
-- trivially true for the owner, but so is the admin branch for anyone
-- with that role), leaving a group with no owner row instead of going
-- through groups_delete_owner_only, which cascades correctly.
DROP POLICY IF EXISTS "group_members_delete_self_or_admin" ON public.group_members;
CREATE POLICY "group_members_delete_self_or_admin"
  ON public.group_members FOR DELETE
  USING (
    role <> 'owner'
    AND (
      auth.uid() = user_id
      OR EXISTS (SELECT 1 FROM public.groups WHERE id = group_id AND owner_id = auth.uid())
      OR public.user_group_role(group_id, auth.uid()) = 'admin'
    )
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- PART C — Read RPCs (profiles stays locked to auth.uid() = id; these
-- return an explicit safe-column allowlist for fellow group members, the
-- same approach 046 used for search_users()/get_friend_profile())
-- ═══════════════════════════════════════════════════════════════════════════

-- Roster for a group the caller belongs to (any status — active members,
-- owner/admin can see invited/pending_approval rows too since group_members
-- SELECT RLS already exposes those rows to any active member; this just
-- adds the profile card data on top).
CREATE OR REPLACE FUNCTION public.get_group_members(p_group_id UUID)
RETURNS TABLE (
  member_id     UUID,
  user_id       UUID,
  username      TEXT,
  display_name  TEXT,
  avatar_emoji  TEXT,
  current_level INTEGER,
  role          TEXT,
  status        TEXT,
  invited_by    UUID,
  created_at    TIMESTAMPTZ,
  responded_at  TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller UUID := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF public.user_group_role(p_group_id, v_caller) IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.groups WHERE id = p_group_id AND owner_id = v_caller) THEN
    RETURN; -- not a member — empty result, not an error, avoids confirming the group exists
  END IF;

  RETURN QUERY
  SELECT gm.id, p.id, p.username, p.display_name, p.avatar_emoji, p.current_level,
         gm.role, gm.status, gm.invited_by, gm.created_at, gm.responded_at
  FROM public.group_members gm
  JOIN public.profiles p ON p.id = gm.user_id
  WHERE gm.group_id = p_group_id
  ORDER BY
    CASE gm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
    gm.created_at ASC;
END;
$$;

-- One round trip for "my groups" page: active groups (with role + member
-- count), pending invites I've received, pending join requests I've sent.
-- Same consolidation rationale as list_friends() (046) and
-- get_partner_status() (047).
CREATE OR REPLACE FUNCTION public.list_my_groups()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_groups JSONB;
  v_invites JSONB;
  v_requests JSONB;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'group_id', g.id,
    'name', g.name,
    'description', g.description,
    'emoji', g.emoji,
    'group_type', g.group_type,
    'is_active', g.is_active,
    'xp_total', g.xp_total,
    'my_role', gm.role,
    'member_count', (SELECT count(*) FROM public.group_members gm2 WHERE gm2.group_id = g.id AND gm2.status = 'active')
  ) ORDER BY g.created_at DESC), '[]'::jsonb)
  INTO v_groups
  FROM public.group_members gm
  JOIN public.groups g ON g.id = gm.group_id
  WHERE gm.user_id = v_caller AND gm.status = 'active';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'member_id', gm.id, 'group_id', g.id, 'name', g.name, 'emoji', g.emoji,
    'invited_by', p.display_name, 'created_at', gm.created_at
  ) ORDER BY gm.created_at DESC), '[]'::jsonb)
  INTO v_invites
  FROM public.group_members gm
  JOIN public.groups g ON g.id = gm.group_id
  LEFT JOIN public.profiles p ON p.id = gm.invited_by
  WHERE gm.user_id = v_caller AND gm.status = 'invited';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'member_id', gm.id, 'group_id', g.id, 'name', g.name, 'emoji', g.emoji, 'created_at', gm.created_at
  ) ORDER BY gm.created_at DESC), '[]'::jsonb)
  INTO v_requests
  FROM public.group_members gm
  JOIN public.groups g ON g.id = gm.group_id
  WHERE gm.user_id = v_caller AND gm.status = 'pending_approval';

  RETURN jsonb_build_object('groups', v_groups, 'pending_invites', v_invites, 'pending_join_requests', v_requests);
END;
$$;
