-- ─────────────────────────────────────────────────────────────────────────────
-- 031_down.sql
-- Rollback for 031_transactions_rls_restrict_delete.sql
-- ─────────────────────────────────────────────────────────────────────────────
--
-- DATA LOSS: None — this is a policy change, not a data change.
--
-- WARNING: Running this rollback restores a CONFIRMED VULNERABILITY.
--   After rollback, authenticated users can again permanently delete their
--   own transaction records via direct Supabase REST API calls, bypassing
--   all application-layer financial integrity protections.
--
--   Only run this if the new policies are confirmed to break a specific
--   application function (which should not be possible given no
--   application code deletes or updates individual transaction rows —
--   but this rollback path exists in case that analysis was wrong).
--
-- SAFE TO RUN: Yes — idempotent via DROP POLICY IF EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can read own transactions"   ON public.transactions;
DROP POLICY IF EXISTS "Users can insert own transactions" ON public.transactions;

CREATE POLICY "Users can CRUD own transactions"
  ON public.transactions FOR ALL USING (auth.uid() = user_id);