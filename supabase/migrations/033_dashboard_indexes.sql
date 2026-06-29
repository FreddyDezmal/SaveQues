-- ─────────────────────────────────────────────────────────────────────────────
-- 033_dashboard_indexes.sql
-- Sprint 13 — P1: Dashboard index verification for get_dashboard_data() RPC
-- ─────────────────────────────────────────────────────────────────────────────
-- All indexes use IF NOT EXISTS — safe to run on any environment.
-- Migration 024 added general performance indexes; this migration adds
-- the specific composite indexes needed by the RPC's access patterns.
-- ─────────────────────────────────────────────────────────────────────────────

-- savings_goals: user_id lookup
CREATE INDEX IF NOT EXISTS idx_savings_goals_user_id
  ON public.savings_goals(user_id);

-- user_challenges: (user_id, status) — active challenges filter
CREATE INDEX IF NOT EXISTS idx_user_challenges_user_status
  ON public.user_challenges(user_id, status);

-- user_challenges: completed timeline filter
CREATE INDEX IF NOT EXISTS idx_user_challenges_timeline
  ON public.user_challenges(user_id, completed_at DESC)
  WHERE status = 'completed';

-- activity_log: 30-day heatmap
CREATE INDEX IF NOT EXISTS idx_activity_log_user_date
  ON public.activity_log(user_id, activity_date DESC);

-- daily_quest_logs: today's quest check
CREATE INDEX IF NOT EXISTS idx_daily_quest_logs_user_date
  ON public.daily_quest_logs(user_id, quest_date);

-- transactions: timeline ordering
CREATE INDEX IF NOT EXISTS idx_transactions_user_created
  ON public.transactions(user_id, created_at DESC);

-- transactions: partial index for has_deposit EXISTS check
CREATE INDEX IF NOT EXISTS idx_transactions_user_deposit
  ON public.transactions(user_id)
  WHERE transaction_type = 'deposit' AND amount > 0;

-- quest_chain_progress: user_id lookup
CREATE INDEX IF NOT EXISTS idx_quest_chain_progress_user
  ON public.quest_chain_progress(user_id);