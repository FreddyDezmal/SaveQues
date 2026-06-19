-- ─────────────────────────────────────────────────────────────────────────────
-- 024_performance_indexes.sql
-- Sprint 8 — Add missing indexes on high-query-volume tables
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHY
--   transactions and savings_goals are queried on every deposit, every
--   dashboard load, and every goal detail view. Neither table has a
--   user_id index. At 20 users this is invisible. At 500+ users with
--   real transaction history, every deposit triggers a full sequential
--   scan of the transactions table.
--
-- SAFETY
--   All statements use CREATE INDEX IF NOT EXISTS — safe to re-run.
--   These are standard B-tree indexes with no risk to existing data.
--   At beta scale (< 100 users) they apply instantly. At larger scale,
--   replace with CREATE INDEX CONCURRENTLY to avoid table locks.
--
-- ─────────────────────────────────────────────────────────────────────────────

-- ── transactions ──────────────────────────────────────────────────────────────
-- Most critical: every dashboard load and deposit queries by user_id

CREATE INDEX IF NOT EXISTS idx_transactions_user_id
  ON public.transactions(user_id);

-- Dashboard and quest completion query transactions by user_id + date
CREATE INDEX IF NOT EXISTS idx_transactions_user_created_at
  ON public.transactions(user_id, created_at DESC);

-- Goal detail activity timeline queries by goal_id
CREATE INDEX IF NOT EXISTS idx_transactions_goal_id
  ON public.transactions(goal_id);

-- ── savings_goals ─────────────────────────────────────────────────────────────
-- Dashboard loads all goals for a user on every page view

CREATE INDEX IF NOT EXISTS idx_savings_goals_user_id
  ON public.savings_goals(user_id);

-- Dashboard filters for incomplete (active) goals
CREATE INDEX IF NOT EXISTS idx_savings_goals_user_active
  ON public.savings_goals(user_id)
  WHERE is_complete = FALSE;

-- ── user_challenges ───────────────────────────────────────────────────────────
-- Dashboard queries active challenges per user

CREATE INDEX IF NOT EXISTS idx_user_challenges_user_status
  ON public.user_challenges(user_id, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification queries (run manually after migration):
--
-- SELECT indexname, tablename FROM pg_indexes
-- WHERE tablename IN ('transactions', 'savings_goals', 'user_challenges')
-- AND schemaname = 'public'
-- ORDER BY tablename, indexname;
-- ─────────────────────────────────────────────────────────────────────────────