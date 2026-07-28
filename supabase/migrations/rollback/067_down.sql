-- ─────────────────────────────────────────────────────────────────────────────
-- 067_down.sql
-- Rollback for 067_financial_health_snapshots.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Drops the financial_health_score_snapshots table entirely (CASCADE via
-- DROP TABLE also removes its policy, index, and unique constraint — no
-- separate DROP POLICY/DROP INDEX needed). Genuine data loss: every
-- persisted daily health-score snapshot is gone after this runs. The live
-- score computation itself (lib/financialHealthScore.ts) is entirely
-- unaffected — it's a pure function of current data and doesn't read this
-- table — only historical trend/sparkline views lose their data.
--
-- WARNING: after this runs, /api/cron/financial-health-snapshot and any
-- dashboard trend chart reading this table will fail (missing table)
-- until that code is rolled back too.
-- ─────────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS public.financial_health_score_snapshots;
