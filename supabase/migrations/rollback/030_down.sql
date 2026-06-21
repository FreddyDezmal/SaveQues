-- ─────────────────────────────────────────────────────────────────────────────
-- 030_down.sql
-- Rollback for 030_request_outcomes.sql
-- ─────────────────────────────────────────────────────────────────────────────
--
-- DATA LOSS: Yes, but low-stakes — request_outcomes is operational
--   monitoring data with a 7-day useful window by design (see migration
--   030 header). Losing it means losing recent success-rate trend
--   visibility, not financial or compliance data. No export-first warning
--   needed, unlike audit_logs' rollback.
--
-- WARNING: After this rollback, app/api/transactions/route.ts,
--   app/api/transactions/withdrawal/route.ts, and
--   app/api/quest/daily/complete/route.ts will fail when they try to
--   write to a table that no longer exists, UNLESS the application code's
--   recordOutcome() helper (lib/recordOutcome.ts) is also reverted to a
--   no-op first. Roll back application code before running this script.
--
-- SAFE TO RUN: Yes — idempotent via IF EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.cleanup_old_request_outcomes();
DROP TABLE IF EXISTS public.request_outcomes;