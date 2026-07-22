-- ─────────────────────────────────────────────────────────────────────────────
-- 060_down.sql
-- Rollback for 060_experiments_and_demo_accounts.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Drops both new tables (removes their policies/trigger with them — same
-- reasoning as 059_down.sql: nothing pre-existing to restore) and removes
-- the is_demo column from profiles.
--
-- WARNING: dropping is_demo means app/api/admin/dev-console/* routes will
-- start failing closed (every request 500s or is rejected, depending on
-- how the missing-column error surfaces) rather than silently becoming
-- unsafe — they check `profile.is_demo === true` and a missing column
-- means that check can never pass. That's the correct failure mode for a
-- safety gate: closed, not open. Do not run this rollback while any
-- dev-console route is still deployed and reachable.
-- ─────────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS public.experiment_assignments;
DROP TABLE IF EXISTS public.experiments;

ALTER TABLE public.profiles DROP COLUMN IF EXISTS is_demo;
