-- ─────────────────────────────────────────────────────────────────────────────
-- 030_request_outcomes.sql
-- Sprint 11 — Phase 4: Business Outcome Monitoring
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHY THIS TABLE EXISTS
--   Deposit/withdrawal/quest-completion success rate cannot be computed
--   from existing tables. Confirmed during Phase 1/4 investigation: when a
--   deposit request fails validation, hits the rate limit, or errors at
--   the database layer, the route returns an HTTP error WITHOUT inserting
--   a row into `transactions` — there is no "failed transaction" row to
--   count. Failures only ever produce log lines and Sentry events today,
--   neither of which is queryable from inside Postgres.
--
--   This table is purpose-built to close that gap: one row per REQUEST
--   ATTEMPT (not per successful business write), recording outcome and
--   a coarse reason. It is intentionally minimal — this is a monitoring
--   signal, not a financial record (that remains audit_logs, unaffected
--   by this migration).
--
-- RELATIONSHIP TO OTHER TABLES
--   - NOT a replacement for audit_logs (027) — audit_logs records
--     confirmed business events with rich metadata, permanently, as the
--     financial source of truth. request_outcomes records EVERY attempt,
--     success or failure, with minimal data, for rate calculation only.
--   - NOT a replacement for rate_limit_attempts (026) — that table exists
--     solely to make idempotent-endpoint rate limiting possible by
--     counting attempts; this table exists to make success-RATE
--     monitoring possible. They happen to share the shape (one row per
--     attempt) but serve different purposes and are read by different
--     code (rate limiting reads its own table synchronously inside the
--     request; this table is read only by the periodic business-metrics
--     check, never inside a user-facing request path).
--
-- RETENTION
--   This is operational monitoring data, not a financial or compliance
--   record — safe to prune after a short window (7 days is more than
--   enough for daily success-rate trend monitoring). A cleanup function
--   is provided but not scheduled by default, matching the pattern
--   already established for rate_limit_attempts in migration 026.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.request_outcomes (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  route       TEXT         NOT NULL,
  outcome     TEXT         NOT NULL CHECK (outcome IN ('success', 'failure')),
  -- Coarse reason only — NOT an error message (avoid storing arbitrary
  -- error text in a table read by a metrics job; full error detail
  -- belongs in Sentry/structured logs, which already capture it).
  reason      TEXT,
  -- user_id is intentionally NOT populated by the application wrapper
  -- (lib/recordOutcome.ts) — none of the wrapped routes' JSON response
  -- bodies include it, and extracting it would require parsing the
  -- request body before auth/validation runs, which this wrapper
  -- deliberately does not do to stay simple and never risk interfering
  -- with the route's own request body consumption. request_id is the
  -- correlation key instead — present on every request via middleware.
  user_id     UUID,
  request_id  TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_request_outcomes_route_created
  ON public.request_outcomes(route, created_at DESC);

ALTER TABLE public.request_outcomes ENABLE ROW LEVEL SECURITY;

-- No policy for the authenticated role — this table is written and read
-- exclusively by the service-role client (route instrumentation writes,
-- the periodic business-metrics check reads). Same posture as
-- rate_limit_attempts (026) and audit_logs (027).

CREATE OR REPLACE FUNCTION public.cleanup_old_request_outcomes()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.request_outcomes
  WHERE created_at < NOW() - INTERVAL '7 days';
END;
$$;