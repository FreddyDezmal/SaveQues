-- ─────────────────────────────────────────────────────────────────────────────
-- 034_withdrawal_balance_constraint.sql
-- Sprint 13 — P0-B: Withdrawal overdraft protection
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds a DB-level BEFORE INSERT trigger that rejects withdrawal and
-- goal_purchase transactions where amount > current goal balance.
--
-- WHY BOTH LAYERS?
--   The withdrawal route (app/api/transactions/withdrawal/route.ts) now
--   validates balance before inserting. This trigger is the DB-level backstop
--   that enforces the same constraint for any code path that bypasses the
--   route (future scripts, direct DB access, other API routes).
--
-- ERRCODE 'check_violation' (23514) is caught by the existing error handler
-- in the withdrawal route alongside the 23505 idempotency conflict handler.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_withdrawal_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_amount NUMERIC;
BEGIN
  -- Only applies to withdrawals and goal purchases (not deposits)
  IF NEW.transaction_type IN ('withdrawal', 'goal_purchase') THEN
    SELECT current_amount INTO v_current_amount
    FROM public.savings_goals
    WHERE id = NEW.goal_id;

    -- goal_id is required for withdrawals — reject if goal not found
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Goal not found for withdrawal'
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF NEW.amount > COALESCE(v_current_amount, 0) THEN
      RAISE EXCEPTION 'Insufficient balance: available %, requested %',
        v_current_amount, NEW.amount
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_withdrawal_balance ON public.transactions;
CREATE TRIGGER enforce_withdrawal_balance
  BEFORE INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_withdrawal_balance();