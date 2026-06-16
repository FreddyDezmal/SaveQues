-- ─────────────────────────────────────────────────────────────────────────────
-- 022_onboarding_activation.sql
-- Sprint 6 — Activation & Onboarding
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds three lightweight columns to profiles to persist onboarding state:
--   onboarding_goal_created      BOOLEAN — starter goal was auto-created at signup
--   notification_prompt_dismissed BOOLEAN — user dismissed/accepted notification banner
--   onboarding_completed_at      TIMESTAMPTZ — when all 3 checklist items were done
--
-- All columns are nullable / default false so existing rows are unaffected.
-- No data migration needed — existing users are treated as post-onboarding.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS onboarding_goal_created       BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notification_prompt_dismissed  BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at        TIMESTAMPTZ  DEFAULT NULL;