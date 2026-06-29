-- 034_down.sql
-- Rollback for 034_withdrawal_balance_constraint.sql
DROP TRIGGER IF EXISTS enforce_withdrawal_balance ON public.transactions;
DROP FUNCTION IF EXISTS public.enforce_withdrawal_balance();