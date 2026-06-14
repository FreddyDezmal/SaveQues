-- Weekly quest tracking (separate from user_challenges which tracks challenges)
CREATE TABLE IF NOT EXISTS public.user_weekly_quests (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  quest_id       TEXT NOT NULL,          -- matches QuestTemplate.id from lib/quests.ts
  week_start     DATE NOT NULL,          -- ISO Monday of the week
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'completed', 'expired')),
  accepted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ,
  xp_earned      INTEGER,
  UNIQUE (user_id, week_start)           -- one weekly quest per week per user
);

ALTER TABLE public.user_weekly_quests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own weekly quests" ON public.user_weekly_quests
  FOR ALL USING (auth.uid() = user_id);