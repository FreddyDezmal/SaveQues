-- ─────────────────────────────────────────────────────────────────────────────
-- 026_rate_limit_attempts.sql
-- Sprint — Rate limiting support table
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHY THIS TABLE EXISTS
--   checkRateLimit() in lib/rateLimit.ts counts existing rows in a table
--   within a rolling time window. This works directly for endpoints that
--   write one row per request (transactions, withdrawals).
--
--   It does NOT work for /api/quest/daily/complete: that endpoint is backed
--   by complete_daily_quest(), which is idempotent via a UNIQUE(user_id,
--   quest_date) constraint on daily_quest_logs. A spamming client can call
--   the endpoint 500 times in a minute and only ever produce ONE row (the
--   first successful one) — counting daily_quest_logs rows would never
--   detect the spam, because the spam doesn't create rows.
--
--   This table exists purely to count REQUEST ATTEMPTS (not successful
--   writes) for endpoints with this shape. One row is inserted per request,
--   regardless of whether the underlying business action succeeds,
--   is already-completed, or fails.
--
-- RETENTION
--   Rows older than the longest rate-limit window in use (currently 60
--   minutes) are useless. A daily cleanup is recommended but not required
--   for correctness — the table grows slowly (one row per quest-complete
--   request) and at beta/low-thousands scale this is not a concern.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rate_limit_attempts (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID         NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint    TEXT         NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_attempts_user_endpoint_created
  ON public.rate_limit_attempts(user_id, endpoint, created_at DESC);

ALTER TABLE public.rate_limit_attempts ENABLE ROW LEVEL SECURITY;

-- Users can only see their own attempts (not strictly needed since this
-- table is only ever accessed server-side, but consistent with the rest
-- of the schema's RLS posture).
DROP POLICY IF EXISTS "Users can view own rate limit attempts" ON public.rate_limit_attempts;
CREATE POLICY "Users can view own rate limit attempts"
  ON public.rate_limit_attempts FOR SELECT
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policy for regular users — only the service
-- role (used server-side in API routes) writes to this table.

-- Optional cleanup function — safe to call from a cron job if the table
-- grows large enough to matter. Not scheduled by default.
CREATE OR REPLACE FUNCTION public.cleanup_old_rate_limit_attempts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.rate_limit_attempts
  WHERE created_at < NOW() - INTERVAL '24 hours';
END;
$$;