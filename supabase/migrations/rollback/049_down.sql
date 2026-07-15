-- ─────────────────────────────────────────────────────────────────────────────
-- 049_down.sql
-- Rollback for 049_shared_goal_hardening_rpc.sql
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.list_my_shared_goals();
DROP FUNCTION IF EXISTS public.get_shared_goal_detail(UUID);

-- Restore the pre-049 ownership trigger (no group-membership check)
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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_shared_goal_member_transition ON public.shared_goal_members;
DROP FUNCTION IF EXISTS public.enforce_shared_goal_member_transition();

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
