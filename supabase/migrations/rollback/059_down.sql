-- ─────────────────────────────────────────────────────────────────────────────
-- 059_down.sql
-- Rollback for 059_feature_flags.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Written retroactively (the original migration shipped without one — see
-- 060_down.sql and onward for new migrations, which now include a rollback
-- from the start per this repo's supabase/migrations/rollback/ convention).
--
-- Drops both tables outright rather than trying to "undo" RLS policies
-- individually — unlike some rollbacks in this directory (e.g. 047_down.sql)
-- that restore a PRIOR policy version because the table predates the
-- migration being rolled back, feature_flags and feature_flag_overrides
-- were created BY 059 with nothing before them to restore. DROP TABLE
-- already removes their policies/trigger with them.
--
-- WARNING: this deletes all flag configuration and every user's override
-- rows. Fine for the intended use (undoing a bad deploy shortly after it
-- shipped, before real flag data accumulates) — NOT something to run
-- against a production database with live flags/rollouts in flight.
-- ─────────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS public.feature_flag_overrides;
DROP TABLE IF EXISTS public.feature_flags;
