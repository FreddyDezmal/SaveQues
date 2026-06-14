-- ============================================================
-- Migration 006 — Weekly quest state + Transaction types
-- ============================================================

-- ── WEEKLY QUEST STATE ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_weekly_quests (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  quest_id     TEXT NOT NULL,
  week_start   DATE NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'completed', 'expired')),
  accepted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  xp_earned    INTEGER,
  UNIQUE (user_id, week_start)
);

ALTER TABLE public.user_weekly_quests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can CRUD own weekly quests"
ON public.user_weekly_quests;

CREATE POLICY "Users can CRUD own weekly quests"
ON public.user_weekly_quests
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- ── TRANSACTION TYPES ─────────────────────────────────────────
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS transaction_type TEXT NOT NULL DEFAULT 'deposit'
    CHECK (transaction_type IN ('deposit', 'withdrawal', 'goal_purchase', 'adjustment'));

-- ── GOAL STATUS ───────────────────────────────────────────────
ALTER TABLE public.savings_goals
  ADD COLUMN IF NOT EXISTS goal_status TEXT NOT NULL DEFAULT 'active'
    CHECK (goal_status IN ('active', 'paused', 'completed', 'archived')),
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_primary   BOOLEAN NOT NULL DEFAULT FALSE;

-- Unique index: one primary goal per user at a time
CREATE UNIQUE INDEX IF NOT EXISTS one_primary_goal_per_user
  ON public.savings_goals (user_id)
  WHERE is_primary = TRUE AND goal_status = 'active';

-- ── UPDATE GOAL TRIGGER ───────────────────────────────────────
-- Handles all transaction types correctly
CREATE OR REPLACE FUNCTION public.update_goal_amount()
RETURNS TRIGGER AS $$
DECLARE
  delta NUMERIC;
BEGIN
  IF NEW.transaction_type = 'deposit' THEN
    delta := NEW.amount;
  ELSE
    -- withdrawal, goal_purchase, adjustment all subtract
    delta := -NEW.amount;
  END IF;

  UPDATE public.savings_goals
  SET current_amount = GREATEST(0, current_amount + delta)
  WHERE id = NEW.goal_id;

  -- goal_purchase that reaches target = completion
  IF NEW.transaction_type = 'goal_purchase' THEN
    UPDATE public.savings_goals
    SET goal_status  = 'completed',
        is_complete  = TRUE,
        completed_at = NOW()
    WHERE id = NEW.goal_id
      AND current_amount >= target_amount;
  END IF;

  -- deposit that reaches target = complete
  IF NEW.transaction_type = 'deposit' THEN
    UPDATE public.savings_goals
    SET is_complete = TRUE
    WHERE id = NEW.goal_id
      AND current_amount >= target_amount
      AND is_complete = FALSE;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger (idempotent)
DROP TRIGGER IF EXISTS on_transaction_insert ON public.transactions;
CREATE TRIGGER on_transaction_insert
  AFTER INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_goal_amount();

-- ── CURRENCY / LOCALE ─────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'ZAR',
  ADD COLUMN IF NOT EXISTS locale        TEXT NOT NULL DEFAULT 'en-ZA',
  ADD COLUMN IF NOT EXISTS country_code  TEXT NOT NULL DEFAULT 'ZA';