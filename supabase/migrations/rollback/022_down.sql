-- ─────────────────────────────────────────────────────────────────────────────
-- 022_down.sql
-- Rollback for 022_onboarding_activation.sql
-- ─────────────────────────────────────────────────────────────────────────────
--
-- REVERSES: addition of three columns to profiles
--   onboarding_goal_created, notification_prompt_dismissed, onboarding_completed_at
--
-- DATA LOSS: Yes — any data stored in these columns is permanently lost.
--   At time of writing this means: which users had a starter goal
--   auto-created, which users dismissed the notification prompt, and when
--   each user completed onboarding. This is operational/analytics state,
--   not financial data — losing it does not affect goals, transactions,
--   or XP. Re-running 022_onboarding_activation.sql after this rollback
--   will recreate the columns with all values reset to their defaults
--   (false / false / NULL), not restored to their prior values.
--
-- SAFE TO RUN: Yes — idempotent via IF EXISTS. Running this twice is a no-op
--   the second time.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS onboarding_goal_created,
  DROP COLUMN IF EXISTS notification_prompt_dismissed,
  DROP COLUMN IF EXISTS onboarding_completed_at;