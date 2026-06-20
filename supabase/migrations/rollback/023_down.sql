-- ─────────────────────────────────────────────────────────────────────────────
-- 023_down.sql
-- Rollback for 023_goal_target_amount_constraint.sql
-- ─────────────────────────────────────────────────────────────────────────────
--
-- REVERSES: CHECK (target_amount > 0) constraint on savings_goals
--
-- DATA LOSS: None — this only removes a validation rule. No data is
--   modified or deleted. Existing rows are untouched.
--
-- WARNING: After this rollback, the application's server-side validation
--   in app/api/goal/edit/route.ts is the ONLY remaining guard against
--   target_amount <= 0. The client-side goal creation flow
--   (app/(app)/goals/new/page.tsx) writes directly to Supabase and relies
--   on this constraint as its sole backstop — removing it reopens the
--   division-by-zero risk documented in 023_goal_target_amount_constraint.sql.
--   Only run this rollback if 023 itself is the suspected cause of an
--   incident; otherwise leave it in place.
--
-- SAFE TO RUN: Yes — idempotent via IF EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.savings_goals
  DROP CONSTRAINT IF EXISTS savings_goals_target_amount_positive;