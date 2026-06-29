-- ─────────────────────────────────────────────────────────────────────────────
-- 036_dashboard_timing.sql
-- Sprint 13 — P2-A: Dashboard P95 instrumentation table
-- ─────────────────────────────────────────────────────────────────────────────
-- Lightweight timing table for P50/P95/P99 dashboard latency measurement.
-- Written fire-and-forget from dashboard/page.tsx via service-role client.
-- Retention: 7 days (operational data only — not financial records).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.dashboard_timings (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID        REFERENCES public.profiles(id) ON DELETE CASCADE,
  duration_ms   INTEGER     NOT NULL,
  rpc_ms        INTEGER,
  auth_ms       INTEGER,
  transform_ms  INTEGER,
  is_new_day    BOOLEAN,
  user_stage    TEXT,
  goal_count    INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_timings_created
  ON public.dashboard_timings(created_at DESC);

-- User-stage breakdown index for segmented P95 queries
CREATE INDEX IF NOT EXISTS idx_dashboard_timings_stage_created
  ON public.dashboard_timings(user_stage, created_at DESC);

ALTER TABLE public.dashboard_timings ENABLE ROW LEVEL SECURITY;
-- No authenticated-role policy: written by service-role only.

-- P95 calculation function — called by business-metrics cron
CREATE OR REPLACE FUNCTION public.get_dashboard_p95(
  p_hours INTEGER DEFAULT 24
)
RETURNS TABLE(
  samples    BIGINT,
  p50_ms     NUMERIC,
  p95_ms     NUMERIC,
  p99_ms     NUMERIC,
  avg_rpc_ms NUMERIC,
  avg_auth_ms NUMERIC,
  user_stage TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*)                                                         AS samples,
    ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY duration_ms)) AS p50_ms,
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)) AS p95_ms,
    ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration_ms)) AS p99_ms,
    ROUND(AVG(rpc_ms))                                               AS avg_rpc_ms,
    ROUND(AVG(auth_ms))                                              AS avg_auth_ms,
    user_stage
  FROM public.dashboard_timings
  WHERE created_at > NOW() - (p_hours || ' hours')::INTERVAL
  GROUP BY user_stage
  ORDER BY user_stage;
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_p95(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dashboard_p95(INTEGER) TO service_role;

-- Cleanup function (wire into existing cron or call manually)
CREATE OR REPLACE FUNCTION public.cleanup_old_dashboard_timings()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.dashboard_timings
  WHERE created_at < NOW() - INTERVAL '7 days';
END;
$$;