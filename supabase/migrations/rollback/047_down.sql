-- ─────────────────────────────────────────────────────────────────────────────
-- 047_down.sql
-- Rollback for 047_accountability_partner_hardening.sql
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_partner_status();

DROP TRIGGER IF EXISTS trg_enforce_accountability_transition ON public.accountability_partners;
DROP FUNCTION IF EXISTS public.enforce_accountability_transition();

DROP POLICY IF EXISTS "accountability_update_own" ON public.accountability_partners;
CREATE POLICY "accountability_update_own"
  ON public.accountability_partners FOR UPDATE
  USING (auth.uid() = requester_id OR auth.uid() = partner_id)
  WITH CHECK (auth.uid() = requester_id OR auth.uid() = partner_id);

DROP POLICY IF EXISTS "accountability_insert_own_request" ON public.accountability_partners;
CREATE POLICY "accountability_insert_own_request"
  ON public.accountability_partners FOR INSERT
  WITH CHECK (auth.uid() = requester_id);
