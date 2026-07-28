-- ─────────────────────────────────────────────────────────────────────────────
-- 064_down.sql
-- Rollback for 064_user_digests.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Drops the user_digests table entirely (CASCADE via DROP TABLE also
-- removes its policy and index — no separate DROP POLICY/DROP INDEX
-- needed). This is a genuine data loss: every persisted weekly/monthly
-- digest snapshot is gone after this runs, not just the ability to write
-- new ones. The weekly_summary/monthly_summary rows already written to
-- notification_logs (the inbox highlight + deep link) are untouched —
-- only the FULL breakdown payload those deep links resolve to disappears.
--
-- WARNING: after this runs, runWeeklySummaryScheduler() /
-- runMonthlyDigestScheduler() and the digest detail page (whatever route
-- resolves a digest deep link) will fail until that code is rolled back
-- too.
-- ─────────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS public.user_digests;
