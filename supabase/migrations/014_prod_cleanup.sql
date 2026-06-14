-- ============================================================
-- SaveQuest Migration 014 — Production Cleanup
-- ============================================================
-- Drops two confirmed-orphaned columns from profiles.
-- Every other conflict in the migration history is resolved
-- by IF NOT EXISTS / idempotent guards and requires no action
-- on a running database.
--
-- Pre-run verification (paste into Supabase SQL editor first):
--
--   SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND table_name   = 'profiles'
--     AND column_name  IN ('notification_enabled', 'reflection_day')
--   ORDER BY column_name;
--
-- Expected: 2 rows (both exist, both have defaults, both unused).
--
-- Post-run verification:
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND table_name   = 'profiles'
--     AND column_name  IN ('notification_enabled', 'reflection_day');
--
-- Expected: 0 rows.
-- ============================================================

-- ── DROP ORPHANED COLUMNS ─────────────────────────────────────

-- profiles.notification_enabled
-- Source:    005_weekly_reflections.sql (body is doubled — it appears twice)
-- Conflicts: notifications_enabled (with 's') was added later by
--            20260613_notifications.sql and IS used by the app.
--            This column (without 's') has zero app references.
-- Risk:      None. Default was TRUE so no user had it explicitly set.
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS notification_enabled;

-- profiles.reflection_day
-- Source:    005_weekly_reflections.sql
-- Conflicts: None — this feature was planned but never implemented.
--            The weekly_reflections table exists but reflection_day
--            is never read or written by any API route or component.
-- Risk:      None. All rows have the default value 'sunday'.
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS reflection_day;


-- ── WHAT WAS NOT DROPPED AND WHY ─────────────────────────────

-- savings_goals.goal_status
--   Written by the update_goal_amount() trigger on every transaction.
--   App code never reads it (uses is_complete instead), but it is live
--   data and the trigger depends on it. Dropping would require rewriting
--   the trigger. Left in place as technical debt to address in 015.

-- savings_goals.is_primary
--   Backed by the one_primary_goal_per_user partial index (from 004).
--   No app code reads it today, but the index is a future-proof
--   constraint. Zero data risk; keeping it costs nothing.

-- savings_goals.is_active
--   Used by the completed_goals_summary view (0072_Yikes.sql).
--   Not orphaned.

-- ── INDEX PREDICATE NOTE ──────────────────────────────────────
-- one_primary_goal_per_user was created by 004_primary_goal.sql with:
--   WHERE is_primary = TRUE AND is_active = TRUE AND is_complete = FALSE
--
-- Migration 0062 attempted to recreate it with a different predicate:
--   WHERE is_primary = TRUE AND goal_status = 'active'
--
-- Because 004 sorts before 0062 lexicographically and uses
-- CREATE UNIQUE INDEX IF NOT EXISTS, the 0062 version was silently
-- skipped. The 004 predicate is what is live in production.
--
-- To verify in Supabase SQL editor:
--   SELECT indexname, indexdef
--   FROM pg_indexes
--   WHERE tablename = 'savings_goals'
--     AND indexname = 'one_primary_goal_per_user';
