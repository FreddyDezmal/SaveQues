-- ─────────────────────────────────────────────────────────────────────────────
-- 067_financial_health_snapshots.sql
-- Sprint 28 — Phase 5/11: Financial Health Score — trend history.
--
-- WHY A NEW TABLE (and not "just recompute it"):
-- lib/financialHealthScore.ts's computeFinancialHealthScore() is a pure
-- function of a user's CURRENT transactions/goals/activity — same
-- philosophy as lib/accountHealth.ts. That's sufficient for "what's my
-- score right now," which needs no new storage. It is NOT sufficient for
-- "how has my score moved over the last 90 days" (Phase 11's dashboard
-- trend/sparkline ask): recomputing the score AS OF a past date would
-- require replaying every input (transactions, goals, activity_log) as it
-- existed on that date, which this schema has no clean way to do (no
-- point-in-time/temporal tables), and would be expensive to do for every
-- user on every dashboard load. A lightweight daily snapshot, written once
-- by a scheduled job (same pattern as user_digests, migration 064), is the
-- honest and cheap way to answer a genuinely different question ("what was
-- true on each of the last N days") than the pure function answers
-- ("what's true right now").
--
-- Table shape mirrors analytics_daily_activity (migration 014) — one row
-- per user per UTC calendar date, unique constraint enforces that,
-- upserted daily by the new /api/cron/financial-health-snapshot route
-- (lib/financialHealthSnapshot.ts). Same "server decides, client reads"
-- RLS shape as user_digests: no client INSERT/UPDATE/DELETE policy.
--
-- `factors` is persisted as jsonb (not normalised into columns) for the
-- same reason 064_user_digests.sql chose jsonb for its payload: this is a
-- point-in-time snapshot of a shape defined and owned entirely by
-- lib/financialHealthScore.ts (AccountHealthFactor[]), not a shape any
-- other table or query needs to join against or filter by individual
-- factor — normalising it would add migration churn every time a factor
-- is added/renamed for zero query benefit.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.financial_health_score_snapshots (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date       date NOT NULL,
  score      smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  tier       text NOT NULL CHECK (tier IN ('Excellent', 'Great', 'Healthy', 'Improving', 'Needs Attention', 'Critical')),
  -- Shape matches lib/financialHealthScore.ts's AccountHealthFactor[] exactly.
  factors    jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financial_health_score_snapshots_user_date_unique UNIQUE (user_id, date)
);

ALTER TABLE public.financial_health_score_snapshots ENABLE ROW LEVEL SECURITY;

-- Read-only from the client, written exclusively by the daily cron via the
-- service-role client (bypasses RLS) — same "server decides, client
-- reads" shape as user_digests (064) and notification_logs.
CREATE POLICY "financial_health_score_snapshots_select_own"
  ON public.financial_health_score_snapshots
  FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_financial_health_snapshots_user_date
  ON public.financial_health_score_snapshots (user_id, date DESC);

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================
-- SELECT date, score, tier FROM financial_health_score_snapshots
--   WHERE user_id = '...' ORDER BY date DESC LIMIT 90;
-- SELECT indexname FROM pg_indexes
--   WHERE tablename = 'financial_health_score_snapshots';
-- Expected: idx_financial_health_snapshots_user_date present, plus the
-- implicit unique index backing financial_health_score_snapshots_user_date_unique.
-- ============================================================
