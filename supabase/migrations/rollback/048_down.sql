-- ─────────────────────────────────────────────────────────────────────────────
-- 048_down.sql
-- Rollback for 048_group_hardening_rpc.sql
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.list_my_groups();
DROP FUNCTION IF EXISTS public.get_group_members(UUID);

DROP TRIGGER IF EXISTS trg_enforce_group_member_transition ON public.group_members;
DROP FUNCTION IF EXISTS public.enforce_group_member_transition();

DROP POLICY IF EXISTS "group_members_delete_self_or_admin" ON public.group_members;
CREATE POLICY "group_members_delete_self_or_admin"
  ON public.group_members FOR DELETE
  USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.groups WHERE id = group_id AND owner_id = auth.uid())
    OR public.user_group_role(group_id, auth.uid()) = 'admin'
  );

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

DROP POLICY IF EXISTS "groups_update_owner_or_admin" ON public.groups;
CREATE POLICY "groups_update_owner_or_admin"
  ON public.groups FOR UPDATE
  USING (auth.uid() = owner_id OR public.user_group_role(id, auth.uid()) = 'admin')
  WITH CHECK (auth.uid() = owner_id OR public.user_group_role(id, auth.uid()) = 'admin');
