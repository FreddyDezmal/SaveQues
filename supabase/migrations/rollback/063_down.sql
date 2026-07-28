-- ─────────────────────────────────────────────────────────────────────────────
-- 063_down.sql
-- Rollback for 063_notification_preferences_expansion.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Drops the eleven columns and two CHECK constraints added by 063. The
-- original notification_preferences table (039, Sprint 16) and its own
-- columns/policies/trigger are untouched — this only undoes 063's
-- additive changes.
--
-- WARNING: after this runs, any code path reading/writing the new
-- category toggles (groups, partners, xp, referrals, monthly_summaries),
-- quiet hours, vacation mode, or digest_frequency will fail (missing
-- column) until that code is rolled back too. Roll back code before/with
-- schema, not schema first against a still-deployed app.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_digest_frequency_check,
  DROP CONSTRAINT IF EXISTS notification_preferences_quiet_hours_range;

ALTER TABLE notification_preferences
  DROP COLUMN IF EXISTS digest_frequency,
  DROP COLUMN IF EXISTS vacation_until,
  DROP COLUMN IF EXISTS vacation_mode,
  DROP COLUMN IF EXISTS quiet_hours_end,
  DROP COLUMN IF EXISTS quiet_hours_start,
  DROP COLUMN IF EXISTS quiet_hours_enabled,
  DROP COLUMN IF EXISTS monthly_summaries,
  DROP COLUMN IF EXISTS referrals,
  DROP COLUMN IF EXISTS xp,
  DROP COLUMN IF EXISTS partners,
  DROP COLUMN IF EXISTS groups;
