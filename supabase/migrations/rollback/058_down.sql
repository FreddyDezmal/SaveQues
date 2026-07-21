-- ─────────────────────────────────────────────────────────────────────────────
-- 058_down.sql
-- Rollback for 058_username_onboarding.sql
--
-- Deliberately does NOT touch profiles.username itself, or clear the values
-- the backfill set — see the note below. It only undoes the two purely
-- structural additions from 058: the format CHECK constraint and the
-- availability-check RPC. The `username` column and its uniqueness index
-- are owned by 045_social_foundation.sql, not this migration — if you also
-- want the column itself gone, that's 045_down.sql's job, run separately
-- (and note that DOES drop the column, taking every username with it,
-- backfilled or user-chosen).
--
-- Why the backfilled data is left in place: after 058 has been live for any
-- length of time, there is no reliable way to tell "a username this
-- rollback backfilled" apart from "a username a real person deliberately
-- chose during signup or from Settings" — both are just non-null values in
-- the same column by then. Nulling out every username to undo the backfill
-- would just as destructively erase every real user's deliberate choice
-- made since. Matches 045_down.sql's own stated rollback philosophy:
-- prefer leaving data alone over a partial rollback silently destroying
-- something this migration didn't put there.
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.is_username_available(TEXT);

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_username_format;