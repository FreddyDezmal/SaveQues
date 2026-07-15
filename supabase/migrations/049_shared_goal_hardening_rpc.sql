-- ─────────────────────────────────────────────────────────────────────────────
-- 049_shared_goal_hardening_rpc.sql
-- Sprint 22, Phase 6 — Shared goals
--
-- PART A: same audit as 046/047/048, applied to shared_goal_members before
-- building routes. Same gap, fourth time: "shared_goal_members_update_
-- self_or_owner" (045) let a member update their own row with no column
-- restriction. Concretely: a user with ANY existing shared_goal_members
-- row (from a legitimate invite to Goal A) could UPDATE that row's
-- shared_goal_id to point at an unrelated Goal B and set status='active'
-- in the same statement — WITH CHECK's "auth.uid() = user_id" clause
-- doesn't care what shared_goal_id becomes, only that user_id is still
-- them. That row would then read as an active contributor on Goal B to
-- enforce_contribution_membership, letting them post fake entries into
-- someone else's contribution ledger they were never invited to. Locked
-- shared_goal_id/user_id immutable and centralized valid transitions in a
-- trigger, same shape as 047/048.
--
-- PART B: extends enforce_shared_goal_ownership (045) to also require the
-- owner be an active member of group_id when they attach one — not a
-- security issue (it's the owner's own goal; nothing here would expose
-- another user's data without the owner's own action), but attaching a
-- goal to a group you don't belong to is a confusing state with no
-- legitimate use, so it's rejected outright rather than allowed.
--
-- PART C: read RPCs. First place in this schema where a non-owner gets to
-- see real savings_goals numbers (target_amount, current_amount) — a
-- deliberate, narrow exception to "no amounts" (which is Phase 8's rule
-- for the public/friends ACTIVITY FEED), scoped to only the people who
-- can already see the group_contributions ledger via can_view_shared_goal
-- (045). Contribution tracking and goal health, which Phase 6 explicitly
-- asks for, aren't meaningful without the actual numbers. savings_goals
-- itself is untouched — RLS stays "auth.uid() = user_id" only; these RPCs
-- are the sole read path for anyone else, same pattern as every other
-- safe-column-allowlist RPC in this sprint.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- PART A — Harden shared_goal_members
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "shared_goal_members_update_self_or_owner" ON public.shared_goal_members;
CREATE POLICY "shared_goal_members_update_self_or_owner"
  ON public.shared_goal_members FOR UPDATE
  USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.shared_goals WHERE id = shared_goal_id AND owner_id = auth.uid())
  )
  WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.shared_goals WHERE id = shared_goal_id AND owner_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.enforce_shared_goal_member_transition()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner_id UUID;
BEGIN
  IF NEW.shared_goal_id <> OLD.shared_goal_id OR NEW.user_id <> OLD.user_id THEN
    RAISE EXCEPTION 'shared_goal_id/user_id cannot be changed after creation'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT owner_id INTO v_owner_id FROM public.shared_goals WHERE id = NEW.shared_goal_id;

  IF NEW.status <> OLD.status THEN
    IF OLD.status = 'invited' AND NEW.status = 'active' THEN
      IF auth.uid() <> OLD.user_id THEN
        RAISE EXCEPTION 'Only the invited user can accept this invite'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      NEW.responded_at := COALESCE(NEW.responded_at, NOW());

    ELSIF OLD.status = 'invited' AND NEW.status = 'declined' THEN
      IF auth.uid() <> OLD.user_id AND auth.uid() <> v_owner_id THEN
        RAISE EXCEPTION 'Not allowed to decline this invite'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      NEW.responded_at := COALESCE(NEW.responded_at, NOW());

    ELSIF OLD.status = 'active' AND NEW.status = 'removed' THEN
      IF auth.uid() <> OLD.user_id AND auth.uid() <> v_owner_id THEN
        RAISE EXCEPTION 'Not allowed to remove this contributor'
          USING ERRCODE = 'insufficient_privilege';
      END IF;

    ELSE
      RAISE EXCEPTION 'Invalid shared_goal_members transition: % -> %', OLD.status, NEW.status
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_shared_goal_member_transition ON public.shared_goal_members;
CREATE TRIGGER trg_enforce_shared_goal_member_transition
  BEFORE UPDATE ON public.shared_goal_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_shared_goal_member_transition();


-- ═══════════════════════════════════════════════════════════════════════════
-- PART B — Owner must belong to the group they attach
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.enforce_shared_goal_ownership()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.savings_goals
    WHERE id = NEW.goal_id AND user_id = NEW.owner_id
  ) THEN
    RAISE EXCEPTION 'Goal % does not belong to user %', NEW.goal_id, NEW.owner_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.group_id IS NOT NULL AND public.user_group_role(NEW.group_id, NEW.owner_id) IS NULL THEN
    RAISE EXCEPTION 'Cannot attach a shared goal to a group you are not a member of'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART C — Read RPCs
-- ═══════════════════════════════════════════════════════════════════════════

-- Full detail for one shared goal: real goal numbers (see the file header
-- note on why that's safe here specifically), owner card, group card if
-- any, and each member's status + running total from group_contributions.
-- Returns NULL rather than partial data for a non-participant, so the
-- route can turn that into a 404 without confirming the goal exists.
CREATE OR REPLACE FUNCTION public.get_shared_goal_detail(p_shared_goal_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_sg     RECORD;
  v_goal   RECORD;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT public.can_view_shared_goal(p_shared_goal_id, v_caller) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_sg FROM public.shared_goals WHERE id = p_shared_goal_id;
  SELECT * INTO v_goal FROM public.savings_goals WHERE id = v_sg.goal_id;

  RETURN jsonb_build_object(
    'shared_goal_id', v_sg.id,
    'goal_id', v_goal.id,
    'title', v_goal.title,
    'goal_emoji', v_goal.goal_emoji,
    'category', v_goal.category,
    'target_amount', v_goal.target_amount,
    'current_amount', v_goal.current_amount,
    'target_date', v_goal.target_date,
    'is_complete', v_goal.is_complete,
    'goal_status', v_goal.goal_status,
    'created_at', v_sg.created_at,
    'owner', (
      SELECT jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_emoji', p.avatar_emoji)
      FROM public.profiles p WHERE p.id = v_sg.owner_id
    ),
    'group', (
      CASE WHEN v_sg.group_id IS NULL THEN NULL ELSE (
        SELECT jsonb_build_object('id', g.id, 'name', g.name, 'emoji', g.emoji)
        FROM public.groups g WHERE g.id = v_sg.group_id
      ) END
    ),
    'members', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'member_id', sgm.id,
        'user_id', p.id,
        'username', p.username,
        'display_name', p.display_name,
        'avatar_emoji', p.avatar_emoji,
        'status', sgm.status,
        'total_contributed', COALESCE((
          SELECT SUM(gc.amount) FROM public.group_contributions gc
          WHERE gc.shared_goal_id = v_sg.id AND gc.user_id = sgm.user_id
        ), 0)
      ) ORDER BY sgm.created_at ASC), '[]'::jsonb)
      FROM public.shared_goal_members sgm
      JOIN public.profiles p ON p.id = sgm.user_id
      WHERE sgm.shared_goal_id = v_sg.id
    ),
    'total_group_contributions', COALESCE((
      SELECT SUM(gc.amount) FROM public.group_contributions gc WHERE gc.shared_goal_id = v_sg.id
    ), 0)
  );
END;
$$;

-- "My shared goals" round trip: goals I own and shared (with group), goals
-- I actively contribute to, and pending invites — same consolidation
-- rationale as list_friends()/get_partner_status()/list_my_groups().
CREATE OR REPLACE FUNCTION public.list_my_shared_goals()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_owned JSONB;
  v_contributing JSONB;
  v_invites JSONB;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'shared_goal_id', sg.id, 'goal_id', g.id, 'title', g.title, 'goal_emoji', g.goal_emoji,
    'target_amount', g.target_amount, 'current_amount', g.current_amount, 'is_complete', g.is_complete,
    'group_id', sg.group_id,
    'contributor_count', (SELECT count(*) FROM public.shared_goal_members m WHERE m.shared_goal_id = sg.id AND m.status = 'active')
  ) ORDER BY sg.created_at DESC), '[]'::jsonb)
  INTO v_owned
  FROM public.shared_goals sg
  JOIN public.savings_goals g ON g.id = sg.goal_id
  WHERE sg.owner_id = v_caller;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'shared_goal_id', sg.id, 'goal_id', g.id, 'title', g.title, 'goal_emoji', g.goal_emoji,
    'target_amount', g.target_amount, 'current_amount', g.current_amount, 'is_complete', g.is_complete,
    'owner_display_name', p.display_name,
    'my_total_contributed', COALESCE((
      SELECT SUM(gc.amount) FROM public.group_contributions gc
      WHERE gc.shared_goal_id = sg.id AND gc.user_id = v_caller
    ), 0)
  ) ORDER BY sgm.created_at DESC), '[]'::jsonb)
  INTO v_contributing
  FROM public.shared_goal_members sgm
  JOIN public.shared_goals sg ON sg.id = sgm.shared_goal_id
  JOIN public.savings_goals g ON g.id = sg.goal_id
  JOIN public.profiles p ON p.id = sg.owner_id
  WHERE sgm.user_id = v_caller AND sgm.status = 'active';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'member_id', sgm.id, 'shared_goal_id', sg.id, 'goal_title', g.title, 'goal_emoji', g.goal_emoji,
    'owner_display_name', p.display_name, 'created_at', sgm.created_at
  ) ORDER BY sgm.created_at DESC), '[]'::jsonb)
  INTO v_invites
  FROM public.shared_goal_members sgm
  JOIN public.shared_goals sg ON sg.id = sgm.shared_goal_id
  JOIN public.savings_goals g ON g.id = sg.goal_id
  JOIN public.profiles p ON p.id = sg.owner_id
  WHERE sgm.user_id = v_caller AND sgm.status = 'invited';

  RETURN jsonb_build_object('owned', v_owned, 'contributing', v_contributing, 'pending_invites', v_invites);
END;
$$;
