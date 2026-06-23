-- ─────────────────────────────────────────────────────────────────────────────
-- 031_transactions_rls_restrict_delete.sql
-- Sprint 12 Independent Audit — Blocking Fix #2
-- ─────────────────────────────────────────────────────────────────────────────
--
-- VULNERABILITY IDENTIFIED
--   The existing transactions RLS policy (from 014_consolidated_schema.sql):
--
--     CREATE POLICY "Users can CRUD own transactions"
--       ON public.transactions FOR ALL USING (auth.uid() = user_id);
--
--   "FOR ALL" includes SELECT, INSERT, UPDATE, and DELETE.
--   An authenticated user with a valid session can issue a direct DELETE
--   to the Supabase REST API:
--
--     DELETE /rest/v1/transactions?id=eq.<their_transaction_id>
--     Authorization: Bearer <their_session_jwt>
--     apikey: <public_anon_key>
--
--   The anon key is publicly visible in the client bundle (it is safe
--   to expose as a public key; it is scoped by RLS). The session JWT is
--   readable from the auth cookie (httpOnly: false in @supabase/ssr by
--   design). Therefore ANY authenticated user can permanently delete
--   their own transaction records, bypassing all application-layer
--   protections and corrupting their financial history.
--
--   This leaves audit_logs rows (migration 027) with no corresponding
--   transactions row — an audit entry for a deposit that officially
--   never existed. The financial integrity guarantees of Sprint 10's
--   idempotency and Sprint 12's audit logging are both undermined by
--   this single overly-permissive policy.
--
-- FIX
--   Replace the single FOR ALL policy with two narrower policies:
--   SELECT (users read their own transactions) and INSERT (application
--   inserts on behalf of the user). No UPDATE policy (transactions are
--   immutable after creation — no application code updates transaction
--   rows). No DELETE policy (transactions are never deleted by users —
--   only by goal-delete CASCADE via service role, and account deletion
--   via admin.deleteUser(), both of which bypass RLS by design).
--
-- IMPACT ON APPLICATION CODE: NONE
--   Every application path that reads transactions uses the RLS-scoped
--   client (createClient()) with the user's session, covered by the new
--   SELECT policy. Every application path that writes transactions uses
--   the same client for INSERT, covered by the new INSERT policy. No
--   route deletes individual transaction rows or updates them — confirmed
--   by reading every route in app/api/ during the Sprint 12 audit.
--
-- IMPACT ON CASCADES: NONE
--   DELETE /api/goal/delete uses createServiceClient() (service role),
--   which bypasses RLS. The goal → transactions FK cascade runs as the
--   service role. Removing the user-level DELETE policy does not affect
--   this path.
--
--   DELETE /api/account uses admin.deleteUser() which cascades auth.users
--   → profiles → transactions via FK. This also runs as a privileged
--   role that bypasses RLS.
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 1: Drop the overly-permissive FOR ALL policy
DROP POLICY IF EXISTS "Users can CRUD own transactions" ON public.transactions;

-- Step 2: Create SELECT-only policy for reading own transactions
CREATE POLICY "Users can read own transactions"
  ON public.transactions
  FOR SELECT
  USING (auth.uid() = user_id);

-- Step 3: Create INSERT-only policy for writing new transactions
-- The application always sets user_id = auth.uid() server-side, but the
-- WITH CHECK provides a database-level guarantee that a user can never
-- insert a transaction owned by a different user, even if the server
-- code had a bug.
CREATE POLICY "Users can insert own transactions"
  ON public.transactions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- No UPDATE policy — transactions are immutable after creation.
-- No DELETE policy — users cannot delete financial records.
-- Service role and FK cascades bypass RLS and are unaffected.

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification (run manually after migration):
--
-- 1. Confirm old policy is gone, new policies exist:
--    SELECT policyname, cmd FROM pg_policies
--    WHERE tablename = 'transactions'
--    ORDER BY cmd;
--    Expected: 2 rows — "Users can read own transactions" (r),
--              "Users can insert own transactions" (a)
--
-- 2. Attempt a direct DELETE via Supabase REST API with a user session:
--    DELETE /rest/v1/transactions?id=eq.<any_transaction_id>
--    This should now return 0 rows affected (RLS blocks it silently)
--    or a 403, depending on Supabase's PostgREST configuration.
--
-- 3. Confirm application flows still work:
--    - Deposit a transaction → succeeds (INSERT policy allows)
--    - View goal detail page → transactions visible (SELECT policy allows)
--    - Delete a goal → transactions cascade-deleted (service role bypasses RLS)
-- ─────────────────────────────────────────────────────────────────────────────