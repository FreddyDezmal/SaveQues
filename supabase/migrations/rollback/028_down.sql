-- ─────────────────────────────────────────────────────────────────────────────
-- 028_down.sql
-- Rollback for 028_transaction_idempotency.sql
-- ─────────────────────────────────────────────────────────────────────────────
--
-- DATA LOSS: Idempotency keys on existing rows are lost (the column and
--   its values are dropped). The transactions themselves (amount, goal_id,
--   user_id, etc.) are completely unaffected — this only removes the
--   deduplication metadata, not financial data.
--
-- WARNING: After this rollback, the application's idempotency check in
--   POST /api/transactions and POST /api/transactions/withdrawal will
--   fail at the database layer (the unique index no longer exists) and
--   must be reverted in application code FIRST, or those routes will
--   throw on every request once they try to query/insert a column that
--   no longer exists. Always roll back application code before running
--   this script, never the reverse order.
--
-- SAFE TO RUN: Yes — idempotent via IF EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS public.idx_transactions_user_idempotency_key;

ALTER TABLE public.transactions
  DROP COLUMN IF EXISTS idempotency_key;