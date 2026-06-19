-- ─────────────────────────────────────────────────────────────────────────────
-- 023_goal_target_amount_constraint.sql
-- Sprint 8 — Add CHECK (target_amount > 0) to savings_goals
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHY
--   The new goal form disables the submit button when target_amount is empty,
--   but there is no database-level guarantee preventing a zero or negative
--   target_amount from being inserted via the API directly.
--   A goal with target_amount = 0 causes a division-by-zero in the progress
--   percent calculation and renders a broken goal card.
--
-- SAFETY
--   Before adding the constraint, verify no existing rows would violate it.
--   The DO block below checks and raises an informative error if any do —
--   in practice this should never happen as the UI has always required > 0.
--
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  bad_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO bad_count
  FROM public.savings_goals
  WHERE target_amount <= 0;

  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add CHECK constraint: % row(s) in savings_goals have target_amount <= 0. '
      'Fix or remove these rows before re-running this migration.',
      bad_count;
  END IF;
END $$;

ALTER TABLE public.savings_goals
  ADD CONSTRAINT savings_goals_target_amount_positive
  CHECK (target_amount > 0);

-- Verification query (run manually after migration to confirm):
-- SELECT COUNT(*) FROM public.savings_goals WHERE target_amount <= 0;
-- Expected: 0