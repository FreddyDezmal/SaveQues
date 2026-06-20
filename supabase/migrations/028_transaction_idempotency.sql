-- ─────────────────────────────────────────────────────────────────────────────
-- 028_transaction_idempotency.sql
-- Sprint 10 — Part 1: Transaction Idempotency
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHY
--   Double-clicks, browser back/retry, flaky mobile connections, and
--   network-layer retries (some HTTP clients/proxies automatically retry
--   POST requests on timeout) can all cause the SAME logical deposit or
--   withdrawal to be submitted twice. Without an idempotency key, this
--   creates two transactions rows, double-counts the user's savings,
--   awards XP twice, and corrupts financial history that the rest of
--   this sprint's audit_logs table is supposed to make trustworthy.
--
-- DESIGN — NULL HANDLING
--   idempotency_key is added as NULLABLE, not NOT NULL. Reasoning:
--
--   1. Existing rows (every transaction created before this migration)
--     have no idempotency key and never will — there's no way to
--     retroactively know what "logical request" produced them, and
--     fabricating a key (e.g. one per existing row) would create a FALSE
--     impression of idempotency protection that never existed for that
--     data. NULL is the honest representation of "this row predates the
--     idempotency system."
--
--   2. New rows, going forward, REQUIRE a key — this is enforced at the
--     API level (POST /api/transactions and /api/transactions/withdrawal
--     reject requests with no idempotency_key), not at the DB level,
--     because a DB-level NOT NULL constraint cannot distinguish
--     "old row, correctly NULL" from "new row, incorrectly NULL" — it
--     would have to be added AFTER backfilling, which Part 1's own
--     reasoning above says we should not fabricate. The API-level
--     requirement is the correct enforcement point: it's checked before
--     any row exists, with full context (this is a NEW request) that the
--     database alone does not have.
--
--   3. NO BACKFILL IS PERFORMED. Backfilling would either leave existing
--     rows NULL (no-op, so why backfill) or invent synthetic keys for
--     historical data, which is worse than NULL because it implies a
--     guarantee retroactively that was never enforced at the time.
--
-- UNIQUENESS SCOPE
--   UNIQUE(user_id, idempotency_key) — scoped per user, not global. Two
--   different users generating the same random UUID (astronomically
--   unlikely with crypto.randomUUID(), but the constraint should be
--   correct regardless) must not collide with each other's deposits.
--   The constraint is a PARTIAL unique index (WHERE idempotency_key IS
--   NOT NULL) so multiple historical NULL rows for the same user do not
--   violate uniqueness against each other — NULL is never considered
--   equal to NULL in a standard unique constraint, but using a partial
--   index here makes that behaviour explicit and self-documenting rather
--   than relying on implicit NULL-handling semantics.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS idempotency_key UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_user_idempotency_key
  ON public.transactions(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Verification query (run manually after migration):
--
-- SELECT COUNT(*) AS rows_with_key, COUNT(*) FILTER (WHERE idempotency_key IS NULL) AS rows_without_key
-- FROM public.transactions;
-- Expected immediately after migration: rows_with_key = 0 (column just added),
-- rows_without_key = total existing row count. New deposits/withdrawals from
-- this point forward will populate the column via the updated API routes.