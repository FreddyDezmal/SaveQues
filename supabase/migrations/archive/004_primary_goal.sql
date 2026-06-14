-- ============================================================
-- SaveQuest Migration 004
-- Adds: currency/locale for global readiness
--       primary goal flag
--       weekly_reflections table
-- ============================================================

-- ── GLOBAL READINESS ─────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'ZAR',
  ADD COLUMN IF NOT EXISTS locale        TEXT NOT NULL DEFAULT 'en-ZA',
  ADD COLUMN IF NOT EXISTS country_code  TEXT NOT NULL DEFAULT 'ZA';

-- ── PRIMARY GOAL ─────────────────────────────────────────────
ALTER TABLE public.savings_goals
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_active  BOOLEAN NOT NULL DEFAULT TRUE;

-- Ensure only one primary goal per user at a time
CREATE UNIQUE INDEX IF NOT EXISTS one_primary_goal_per_user
  ON public.savings_goals (user_id)
  WHERE is_primary = TRUE AND is_active = TRUE AND is_complete = FALSE;

-- ── WEEKLY REFLECTIONS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.weekly_reflections (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  week_start        DATE NOT NULL,
  savings_count     INTEGER NOT NULL DEFAULT 0,
  quests_completed  INTEGER NOT NULL DEFAULT 0,
  streak_days       INTEGER NOT NULL DEFAULT 0,
  xp_earned         INTEGER NOT NULL DEFAULT 0,
  primary_goal_pct  NUMERIC(5,2),
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  viewed_at         TIMESTAMPTZ,
  UNIQUE (user_id, week_start)
);

ALTER TABLE public.weekly_reflections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own reflections" ON public.weekly_reflections
  FOR ALL USING (auth.uid() = user_id);