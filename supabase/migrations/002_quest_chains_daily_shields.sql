-- ============================================================
-- SaveQuest Migration 002
-- Adds: daily_quest_logs, quest_chain_progress, streak_shields
-- Updates: profiles (adds shield fields + daily quest tracking)
-- ============================================================

-- ── DAILY QUEST LOGS ─────────────────────────────────────────
-- Tracks which daily quest was completed on which date
CREATE TABLE IF NOT EXISTS public.daily_quest_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  quest_id TEXT NOT NULL,                -- matches QuestTemplate.id
  quest_date DATE NOT NULL DEFAULT CURRENT_DATE,
  xp_earned INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, quest_date)           -- one daily quest per day
);

ALTER TABLE public.daily_quest_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own daily_quest_logs" ON public.daily_quest_logs
  FOR ALL USING (auth.uid() = user_id);

-- ── QUEST CHAIN PROGRESS ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.quest_chain_progress (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  chain_id TEXT NOT NULL,                -- matches QuestChain.id
  current_step INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (user_id, chain_id)
);

ALTER TABLE public.quest_chain_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own chain_progress" ON public.quest_chain_progress
  FOR ALL USING (auth.uid() = user_id);

-- ── STREAK SHIELDS ───────────────────────────────────────────
-- Add shield fields to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS streak_shields INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS total_shields_used INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_quests_completed INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weekly_quests_completed INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quest_chains_completed INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS goal_emoji TEXT NOT NULL DEFAULT '⭐',
  ADD COLUMN IF NOT EXISTS longest_streak INTEGER NOT NULL DEFAULT 0;

-- ── ADD EMOJI COL TO GOALS ───────────────────────────────────
ALTER TABLE public.savings_goals
  ADD COLUMN IF NOT EXISTS goal_emoji TEXT NOT NULL DEFAULT '⭐';

-- ── ACTIVITY LOG (for momentum dashboard heatmap) ────────────
CREATE TABLE IF NOT EXISTS public.activity_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  activity_date DATE NOT NULL DEFAULT CURRENT_DATE,
  xp_earned INTEGER NOT NULL DEFAULT 0,
  actions_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, activity_date)
);

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own activity_log" ON public.activity_log
  FOR ALL USING (auth.uid() = user_id);

-- Upsert helper function for activity log
CREATE OR REPLACE FUNCTION public.log_activity(p_user_id UUID, p_xp INTEGER)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.activity_log (user_id, activity_date, xp_earned, actions_count)
  VALUES (p_user_id, CURRENT_DATE, p_xp, 1)
  ON CONFLICT (user_id, activity_date)
  DO UPDATE SET
    xp_earned = activity_log.xp_earned + p_xp,
    actions_count = activity_log.actions_count + 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── SEED SEASONAL QUESTS INTO challenges TABLE ───────────────
INSERT INTO public.challenges (title, description, type, xp_reward, duration_days) VALUES
  ('New Year, New Fund',     'Start a brand-new savings goal in January.',           'seasonal', 500, 31),
  ('Black Friday Blackout',  'Make zero impulse purchases on Black Friday.',          'seasonal', 600, 1),
  ('Month-End Sprint',       'Save at least R500 before the month ends.',             'seasonal', 500, 30),
  ('Tax Season Stash',       'Build your emergency fund — tax season reminder.',      'seasonal', 600, 30),
  ('Winter Warmer Fund',     'Save for a winter-specific expense in June/July.',      'seasonal', 400, 30),
  ('Year in Review',         'Log your total savings for the year this December.',    'seasonal', 800, 31)
ON CONFLICT DO NOTHING;

-- ── ADMIN FLAG ───────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- To make yourself admin, run in SQL editor:
-- UPDATE public.profiles SET is_admin = TRUE WHERE id = '<your-user-uuid>';
