-- ─────────────────────────────────────────────────────────────────────────────
-- 046_down.sql
-- Rollback for 046_friend_system_rpc.sql
--
-- Restores the 045-era policies verbatim before dropping what 046 added.
-- Note: this reintroduces the bugs 046 fixed (insert-status escalation,
-- block-delete bypass, requester/addressee hijack) — only run this if you
-- are also rolling back to a pre-046 application version that doesn't rely
-- on the fixed behavior.
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.list_friends();
DROP FUNCTION IF EXISTS public.get_friend_profile(UUID);
DROP FUNCTION IF EXISTS public.search_users(TEXT, INT);

DROP POLICY IF EXISTS "friendships_update_own" ON public.friendships;
CREATE POLICY "friendships_update_own"
  ON public.friendships FOR UPDATE
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id)
  WITH CHECK (auth.uid() = requester_id OR auth.uid() = addressee_id);

DROP POLICY IF EXISTS "friendships_delete_own" ON public.friendships;
CREATE POLICY "friendships_delete_own"
  ON public.friendships FOR DELETE
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

DROP POLICY IF EXISTS "friendships_insert_own_request" ON public.friendships;
CREATE POLICY "friendships_insert_own_request"
  ON public.friendships FOR INSERT
  WITH CHECK (auth.uid() = requester_id);

DROP TRIGGER IF EXISTS trg_enforce_block_ownership ON public.friendships;
DROP FUNCTION IF EXISTS public.enforce_block_ownership();

ALTER TABLE public.friendships DROP CONSTRAINT IF EXISTS friendships_blocked_by_consistent;
ALTER TABLE public.friendships DROP COLUMN IF EXISTS blocked_by;
