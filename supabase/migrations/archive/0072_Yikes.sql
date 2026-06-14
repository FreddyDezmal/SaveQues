-- Drop the existing view
DROP VIEW IF EXISTS public.completed_goals_summary;

-- Recreate as a standard view (no SECURITY DEFINER)
-- RLS on savings_goals and transactions enforces row-level access automatically
CREATE VIEW public.completed_goals_summary
WITH (security_invoker = true)
AS
SELECT
  g.id,
  g.user_id,
  g.title,
  g.category,
  g.goal_emoji,
  g.target_amount,
  g.current_amount,
  g.completed_at,
  g.created_at,
  EXTRACT(DAY FROM (g.completed_at - g.created_at))::INTEGER AS days_to_complete,
  (
    SELECT COALESCE(SUM(t.amount), 0)
    FROM public.transactions t
    WHERE t.goal_id = g.id
      AND t.transaction_type = 'deposit'
  ) AS total_deposited,
  (
    SELECT COUNT(*)
    FROM public.transactions t
    WHERE t.goal_id = g.id
      AND t.transaction_type = 'deposit'
  ) AS deposit_count
FROM public.savings_goals g
WHERE g.is_complete = TRUE
  AND g.is_active = TRUE;