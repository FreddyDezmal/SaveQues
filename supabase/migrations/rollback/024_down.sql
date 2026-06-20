-- ─────────────────────────────────────────────────────────────────────────────
-- 024_down.sql
-- Rollback for 024_performance_indexes.sql
-- ─────────────────────────────────────────────────────────────────────────────
--
-- REVERSES: six performance indexes added on transactions, savings_goals,
--   and user_challenges.
--
-- DATA LOSS: None — indexes contain no unique data, only pointers for query
--   planning. Dropping them is always safe with respect to data integrity.
--
-- WARNING: Dropping these indexes will reintroduce the full-table-scan
--   performance issue documented in 024_performance_indexes.sql. Only run
--   this rollback if you have concrete evidence the indexes themselves are
--   causing a problem (e.g. unexpected write-amplification on a very
--   high-volume table, or disk space pressure) — this is unlikely at
--   beta-to-low-thousands scale.
--
-- SAFE TO RUN: Yes — idempotent via IF EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS public.idx_transactions_user_id;
DROP INDEX IF EXISTS public.idx_transactions_user_created_at;
DROP INDEX IF EXISTS public.idx_transactions_goal_id;
DROP INDEX IF EXISTS public.idx_savings_goals_user_id;
DROP INDEX IF EXISTS public.idx_savings_goals_user_active;
DROP INDEX IF EXISTS public.idx_user_challenges_user_status;