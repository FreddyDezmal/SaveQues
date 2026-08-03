-- ─────────────────────────────────────────────────────────────────────────────
-- 070_down.sql
-- Rollback for 070_scenario_simulator_premium.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Drops saved_scenarios (CASCADE removes its policy/index too) and the
-- saved_scenarios_limit feature/plan_features rows. Genuine data loss: any
-- scenarios users have saved are gone after this runs.
--
-- WARNING: after this runs, app/api/goal/scenario-saved will fail (missing
-- table) until that route is rolled back too. app/api/goal/scenario-run
-- depends only on the pre-existing scenarios_limit feature (migration 069)
-- and is unaffected by this rollback.
-- ─────────────────────────────────────────────────────────────────────────────

DELETE FROM public.plan_features WHERE feature_key = 'saved_scenarios_limit';
DELETE FROM public.features WHERE key = 'saved_scenarios_limit';

DROP TABLE IF EXISTS public.saved_scenarios;
