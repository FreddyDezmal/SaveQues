-- ============================================================
-- SaveQuest Database Schema
-- Run this in your Supabase SQL editor
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- PROFILES (extends Supabase auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT 'Saver',
  avatar_emoji TEXT NOT NULL DEFAULT '🌱',
  xp_total INTEGER NOT NULL DEFAULT 0,
  current_level INTEGER NOT NULL DEFAULT 1,
  streak_days INTEGER NOT NULL DEFAULT 0,
  last_active_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', 'Saver'));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- SAVINGS GOALS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.savings_goals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'custom',
  target_amount NUMERIC(12, 2) NOT NULL,
  current_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  target_date DATE,
  is_complete BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.savings_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own goals" ON public.savings_goals
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- TRANSACTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  goal_id UUID NOT NULL REFERENCES public.savings_goals(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own transactions" ON public.transactions
  FOR ALL USING (auth.uid() = user_id);

-- Auto-update goal current_amount on transaction insert
CREATE OR REPLACE FUNCTION public.update_goal_amount()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.savings_goals
  SET current_amount = current_amount + NEW.amount
  WHERE id = NEW.goal_id;

  -- Check if goal is now complete
  UPDATE public.savings_goals
  SET is_complete = TRUE
  WHERE id = NEW.goal_id AND current_amount >= target_amount;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_transaction_insert ON public.transactions;
CREATE TRIGGER on_transaction_insert
  AFTER INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_goal_amount();

-- ============================================================
-- CHALLENGES (admin-seeded, read-only for users)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.challenges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'manual',
  xp_reward INTEGER NOT NULL DEFAULT 200,
  duration_days INTEGER NOT NULL DEFAULT 7,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read challenges" ON public.challenges FOR SELECT USING (TRUE);

-- ============================================================
-- USER CHALLENGES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_challenges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  challenge_id UUID NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE public.user_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own user_challenges" ON public.user_challenges
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- USER ACHIEVEMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_achievements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, achievement_id)
);

ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own achievements" ON public.user_achievements
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- SEED: Default challenges
-- ============================================================
INSERT INTO public.challenges (title, description, type, xp_reward, duration_days) VALUES
  ('No Takeout Week',        'Avoid all takeout and delivery food for 7 days.',              'manual', 300, 7),
  ('Save R50 Daily',         'Log at least R50 in savings every single day this week.',      'manual', 350, 7),
  ('Weekend Spending Freeze','Make zero non-essential purchases this weekend (Sat + Sun).',  'manual', 250, 2),
  ('3-Day Kickstart',        'Log a saving 3 days in a row to build your streak.',           'manual', 150, 3),
  ('Coffee Blackout',        'No bought coffee for 5 days. Brew at home.',                  'manual', 200, 5),
  ('Round-Up Week',          'Every time you spend, log the round-up difference as savings.','manual', 300, 7),
  ('No Shopping Sunday',     'Zero shopping (online or in-store) this Sunday.',             'manual', 100, 1),
  ('Month-End Sprint',       'Save at least R500 before the month ends.',                   'manual', 500, 30)
ON CONFLICT DO NOTHING;
