-- ============================================================
-- SaveQuest Migration 016 — Admin CRUD foundations
-- ============================================================
-- Adds database-backed tables for content that was previously
-- hardcoded in lib/quests.ts and lib/achievements.ts, so Admins
-- can manage it via the Admin Dashboard (Task 3).
--
-- Design notes:
--  • daily_quests / weekly_quests / quest_chains use TEXT primary
--    keys that MATCH the existing slugs in lib/quests.ts
--    (e.g. 'daily_save_any', 'chain_starter_saver'). This preserves
--    compatibility with existing rows in daily_quest_logs
--    (quest_id TEXT) and quest_chain_progress (chain_id TEXT),
--    which reference these slugs as plain strings, not foreign keys.
--  • quest_chain_steps is a normal child table (UUID PK) with a
--    FK to quest_chains and a UNIQUE(chain_id, step_number) for
--    ordering / reordering.
--  • badges uses a TEXT primary key matching the existing
--    lib/achievements.ts ACHIEVEMENTS ids (e.g. 'streak_1'), for
--    the same compatibility reason — user_achievements.achievement_id
--    is TEXT and references these ids as plain strings.
--  • All five tables: RLS enabled, "Anyone can read" SELECT policy
--    (matches the existing `challenges` table pattern — the app
--    needs to read active quests/badges client- and server-side),
--    and NO write policies — all mutations go through
--    /api/admin/* routes using the service-role client
--    (createServiceClient), which bypasses RLS. This matches the
--    existing events admin pattern and ensures "no client-side
--    privilege checks are relied upon".
--  • is_active (quests/chains) / visibility (badges) drive
--    soft-delete: deactivated records are hidden from new
--    assignment but remain so existing user progress
--    (daily_quest_logs, quest_chain_progress, user_achievements)
--    keeps working. Admin DELETE endpoints additionally refuse
--    hard deletes when referencing user-progress rows exist.
-- ============================================================


-- ── badges ───────────────────────────────────────────────────
-- Created first: quest_chains.completion_badge_id references it.
CREATE TABLE IF NOT EXISTS public.badges (
  id              TEXT        PRIMARY KEY,
  title           TEXT        NOT NULL,
  description     TEXT        NOT NULL,
  unlock_criteria TEXT        NOT NULL DEFAULT '',
  category        TEXT        NOT NULL DEFAULT 'special'
                  CHECK (category IN ('streak','savings','quest','social','special','hidden')),
  icon            TEXT        NOT NULL DEFAULT '🏅',
  xp_reward       INTEGER     NOT NULL DEFAULT 0 CHECK (xp_reward >= 0),
  secret          BOOLEAN     NOT NULL DEFAULT FALSE,
  visibility      TEXT        NOT NULL DEFAULT 'visible'
                  CHECK (visibility IN ('visible','hidden')),
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.badges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read badges"
  ON public.badges FOR SELECT USING (TRUE);


-- ── daily_quests ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.daily_quests (
  id          TEXT        PRIMARY KEY,
  title       TEXT        NOT NULL,
  description TEXT        NOT NULL,
  category    TEXT        NOT NULL DEFAULT 'behavioral'
              CHECK (category IN ('savings','behavioral','streak','challenge')),
  xp_reward   INTEGER     NOT NULL DEFAULT 50 CHECK (xp_reward >= 0),
  icon        TEXT        NOT NULL DEFAULT '⭐',
  day_of_week INTEGER     CHECK (day_of_week BETWEEN 0 AND 6),
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.daily_quests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read daily_quests"
  ON public.daily_quests FOR SELECT USING (TRUE);


-- ── weekly_quests ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.weekly_quests (
  id          TEXT        PRIMARY KEY,
  title       TEXT        NOT NULL,
  description TEXT        NOT NULL,
  category    TEXT        NOT NULL DEFAULT 'behavioral'
              CHECK (category IN ('savings','behavioral','streak','challenge')),
  xp_reward   INTEGER     NOT NULL DEFAULT 300 CHECK (xp_reward >= 0),
  icon        TEXT        NOT NULL DEFAULT '⭐',
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.weekly_quests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read weekly_quests"
  ON public.weekly_quests FOR SELECT USING (TRUE);


-- ── quest_chains ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.quest_chains (
  id                  TEXT        PRIMARY KEY,
  title               TEXT        NOT NULL,
  description         TEXT        NOT NULL,
  icon                TEXT        NOT NULL DEFAULT '🔗',
  completion_xp       INTEGER     NOT NULL DEFAULT 0 CHECK (completion_xp >= 0),
  completion_badge_id TEXT        REFERENCES public.badges(id) ON DELETE SET NULL,
  is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.quest_chains ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read quest_chains"
  ON public.quest_chains FOR SELECT USING (TRUE);


-- ── quest_chain_steps ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.quest_chain_steps (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  chain_id          TEXT        NOT NULL REFERENCES public.quest_chains(id) ON DELETE CASCADE,
  step_number       INTEGER     NOT NULL CHECK (step_number >= 1),
  title             TEXT        NOT NULL,
  description       TEXT        NOT NULL,
  xp_reward         INTEGER     NOT NULL DEFAULT 0 CHECK (xp_reward >= 0),
  requires_type     TEXT        NOT NULL
                    CHECK (requires_type IN ('save_amount','streak','complete_quest','complete_daily','open_app')),
  requires_value    INTEGER     NOT NULL DEFAULT 1 CHECK (requires_value >= 0),
  requires_quest_id TEXT,
  UNIQUE (chain_id, step_number)
);

ALTER TABLE public.quest_chain_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read quest_chain_steps"
  ON public.quest_chain_steps FOR SELECT USING (TRUE);

CREATE INDEX IF NOT EXISTS idx_quest_chain_steps_chain ON public.quest_chain_steps(chain_id, step_number);


-- ── updated_at maintenance trigger ──────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_daily_quests_updated_at  ON public.daily_quests;
DROP TRIGGER IF EXISTS trg_weekly_quests_updated_at ON public.weekly_quests;
DROP TRIGGER IF EXISTS trg_quest_chains_updated_at  ON public.quest_chains;
DROP TRIGGER IF EXISTS trg_badges_updated_at        ON public.badges;

CREATE TRIGGER trg_daily_quests_updated_at  BEFORE UPDATE ON public.daily_quests  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_weekly_quests_updated_at BEFORE UPDATE ON public.weekly_quests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_quest_chains_updated_at  BEFORE UPDATE ON public.quest_chains  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_badges_updated_at        BEFORE UPDATE ON public.badges        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ============================================================
-- SEED DATA — copied verbatim from lib/quests.ts / lib/achievements.ts
-- so existing IDs referenced by daily_quest_logs, quest_chain_progress,
-- and user_achievements continue to resolve.
-- ============================================================

-- ── badges seed (60) — from lib/achievements.ts ACHIEVEMENTS ────
-- unlock_criteria defaults to the existing `description` text, which
-- already reads as the unlock requirement for nearly every badge.
INSERT INTO public.badges (id, title, description, unlock_criteria, category, icon, xp_reward, secret) VALUES
  -- STREAK (12)
  ('streak_1',  'First Flame',      'First day active',                   'First day active',                   'streak', '🕯️', 25,   FALSE),
  ('streak_3',  'Getting Warmer',   '3-day streak',                       '3-day streak',                        'streak', '🔥',  50,   FALSE),
  ('streak_7',  'One Week Strong',  '7-day streak',                       '7-day streak',                        'streak', '🔥',  100,  FALSE),
  ('streak_14', 'Two Weeks In',     '14-day streak',                      '14-day streak',                       'streak', '🔥',  200,  FALSE),
  ('streak_21', 'Three Weeks',      '21-day streak',                      '21-day streak',                       'streak', '🔥',  300,  FALSE),
  ('streak_30', 'One Month',        '30-day streak',                      '30-day streak',                       'streak', '🔥',  500,  FALSE),
  ('streak_50', 'Fifty Days',       '50-day streak',                      '50-day streak',                       'streak', '⚡',  750,  FALSE),
  ('streak_66', 'Habit Formed',     '66-day streak',                      '66-day streak',                       'streak', '🧠',  1000, FALSE),
  ('streak_100','Century',          '100-day streak',                     '100-day streak',                      'streak', '💯',  1500, FALSE),
  ('streak_180','Half Year',        '180-day streak',                     '180-day streak',                      'streak', '🌗',  2000, FALSE),
  ('streak_365','Full Year',        '365-day streak',                     '365-day streak',                      'streak', '🏆', 5000, FALSE),
  ('streak_comeback', 'Phoenix',    'Recovered a broken streak and went 7 days again', 'Recovered a broken streak and went 7 days again', 'streak', '🐦‍🔥', 200, FALSE),

  -- SAVINGS (12)
  ('savings_first',   'First Deposit',     'Logged your first saving',         'Logged your first saving',         'savings', '🌱', 25,   FALSE),
  ('savings_100',     'First Hundred',     'Total saved: R100',                'Total saved: R100',                'savings', '💵', 50,   FALSE),
  ('savings_500',     'Half a Grand',      'Total saved: R500',                'Total saved: R500',                'savings', '💵', 100,  FALSE),
  ('savings_1000',    'Four Figures',      'Total saved: R1,000',              'Total saved: R1,000',              'savings', '💰', 200,  FALSE),
  ('savings_5000',    'Serious Saver',     'Total saved: R5,000',              'Total saved: R5,000',              'savings', '💰', 500,  FALSE),
  ('savings_10000',   'Five Figures',      'Total saved: R10,000',             'Total saved: R10,000',             'savings', '🏦', 1000, FALSE),
  ('savings_25000',   'Quarter Mark',      'Total saved: R25,000',             'Total saved: R25,000',             'savings', '🏦', 1500, FALSE),
  ('savings_50000',   'Halfway to 100k',   'Total saved: R50,000',             'Total saved: R50,000',             'savings', '🏦', 2000, FALSE),
  ('savings_100000',  'Six Figures',       'Total saved: R100,000',            'Total saved: R100,000',            'savings', '👑', 3000, FALSE),
  ('goal_first',      'Goal Getter',       'Completed your first savings goal','Completed your first savings goal','savings', '🎯', 150,  FALSE),
  ('goal_5',          'Goal Crusher',      'Completed 5 savings goals',        'Completed 5 savings goals',        'savings', '🎯', 500,  FALSE),
  ('goal_10',         'Goal Machine',      'Completed 10 savings goals',       'Completed 10 savings goals',       'savings', '🎯', 1000, FALSE),

  -- QUEST (12)
  ('quest_first_daily',  'Quest Beginner',  'Completed your first daily quest',       'Completed your first daily quest',       'quest', '📜', 25,   FALSE),
  ('quest_10_daily',     'Quest Regular',   'Completed 10 daily quests',              'Completed 10 daily quests',              'quest', '📜', 100,  FALSE),
  ('quest_50_daily',     'Quest Veteran',   'Completed 50 daily quests',              'Completed 50 daily quests',              'quest', '📜', 400,  FALSE),
  ('quest_100_daily',    'Quest Master',    'Completed 100 daily quests',             'Completed 100 daily quests',             'quest', '📜', 800,  FALSE),
  ('quest_first_weekly', 'Weekly Winner',   'Completed your first weekly quest',      'Completed your first weekly quest',      'quest', '🗓️', 100,  FALSE),
  ('quest_10_weekly',    'Weekly Warrior',  'Completed 10 weekly quests',             'Completed 10 weekly quests',             'quest', '🗓️', 500,  FALSE),
  ('chain_starter',      'Chain Starter',   'Completed the Starter Saver chain',      'Completed the Starter Saver chain',      'quest', '🌱', 150,  FALSE),
  ('chain_complete_1',   'First Chain',     'Completed any quest chain',              'Completed any quest chain',              'quest', '🔗', 200,  FALSE),
  ('chain_complete_3',   'Chain Reaction',  'Completed 3 quest chains',               'Completed 3 quest chains',               'quest', '🔗', 600,  FALSE),
  ('chain_complete_all', 'Chain Champion',  'Completed every quest chain',            'Completed every quest chain',            'quest', '🔗', 1500, FALSE),
  ('no_takeout',         'No-Spend Hero',   'Completed the No-Spend Hero chain',      'Completed the No-Spend Hero chain',      'quest', '🙅', 200,  FALSE),
  ('challenge_first',    'Challenger',      'Joined your first seasonal challenge',   'Joined your first seasonal challenge',   'quest', '🏁', 50,   FALSE),

  -- SOCIAL (8)
  ('event_first',          'Event Goer',         'Participated in your first event',          'Participated in your first event',          'social', '🎉', 50,   FALSE),
  ('event_3',               'Regular Attendee',   'Participated in 3 events',                  'Participated in 3 events',                  'social', '🎉', 150,  FALSE),
  ('event_complete_all',    'Event Completionist','Completed an event fully',                  'Completed an event fully',                  'social', '🎉', 300,  FALSE),
  ('referral_first',        'Inviter',            'Invited a friend to SaveQuest',             'Invited a friend to SaveQuest',             'social', '🤝', 100,  FALSE),
  ('referral_5',            'Community Builder',  'Invited 5 friends',                         'Invited 5 friends',                         'social', '🤝', 500,  FALSE),
  ('profile_complete',      'All Set Up',         'Completed your profile setup',              'Completed your profile setup',              'social', '✅', 25,   FALSE),
  ('avatar_change',         'New Look',           'Changed your avatar',                       'Changed your avatar',                       'social', '🎨', 10,   FALSE),
  ('shared_progress',       'Showing Off',        'Shared your progress',                      'Shared your progress',                      'social', '📤', 50,   FALSE),

  -- SPECIAL (10)
  ('early_adopter',     'Early Adopter',     'Joined SaveQuest in its first month',     'Joined SaveQuest in its first month',     'special', '🚀', 200,  FALSE),
  ('level_10',          'Double Digits',     'Reached level 10',                        'Reached level 10',                        'special', '⭐', 300,  FALSE),
  ('level_25',          'Quarter Century',   'Reached level 25',                        'Reached level 25',                        'special', '⭐', 750,  FALSE),
  ('level_50',          'Halfway Hero',      'Reached level 50',                        'Reached level 50',                        'special', '⭐', 1500, FALSE),
  ('level_100',         'Centurion',         'Reached level 100',                       'Reached level 100',                       'special', '👑', 5000, FALSE),
  ('shield_used',       'Saved by the Bell', 'Used a streak shield',                    'Used a streak shield',                    'special', '🛡️', 50,   FALSE),
  ('xp_10000',          'XP Hoarder',        'Earned 10,000 total XP',                  'Earned 10,000 total XP',                  'special', '✨', 500,  FALSE),
  ('xp_50000',          'XP Tycoon',         'Earned 50,000 total XP',                  'Earned 50,000 total XP',                  'special', '✨', 1500, FALSE),
  ('reflection_first',  'Reflective',        'Completed your first weekly reflection',  'Completed your first weekly reflection',  'special', '🪞', 50,   FALSE),
  ('reflection_10',     'Self Aware',        'Completed 10 weekly reflections',         'Completed 10 weekly reflections',         'special', '🪞', 300,  FALSE),

  -- HIDDEN / SECRET (6)
  ('hidden_midnight',     'Night Owl',         'Logged a saving after midnight',           'Logged a saving after midnight',           'hidden', '🦉', 100, TRUE),
  ('hidden_weekend',      'Weekend Warrior',   'Logged savings on 4 consecutive weekends', 'Logged savings on 4 consecutive weekends', 'hidden', '🏕️', 150, TRUE),
  ('hidden_round_number', 'Round Number',      'Hit a total savings amount ending in 000', 'Hit a total savings amount ending in 000', 'hidden', '🎰', 100, TRUE),
  ('hidden_speedrun',     'Speedrunner',       'Completed a quest chain in record time',   'Completed a quest chain in record time',   'hidden', '⚡', 250, TRUE),
  ('hidden_comeback_kid', 'Comeback Kid',      'Returned after a 30+ day absence',         'Returned after a 30+ day absence',         'hidden', '🔄', 100, TRUE),
  ('hidden_perfectionist','Perfectionist',     'Completed every daily quest in a month',   'Completed every daily quest in a month',   'hidden', '💎', 500, TRUE)
ON CONFLICT (id) DO NOTHING;


-- ── daily_quests seed (7) ──────────────────────────────────────
INSERT INTO public.daily_quests (id, title, description, category, xp_reward, icon) VALUES
  ('daily_checkin',       'Daily Check-In',    'Open SaveQuest and review your goals today.',        'behavioral', 75,  '📱'),
  ('daily_save_any',      'Save Something',    'Log any saving today, no matter how small.',         'savings',    100, '💰'),
  ('daily_skip_purchase', 'Skip One Impulse',  'Identify one impulse purchase you skipped today.',   'behavioral', 75,  '🙅'),
  ('daily_lunch_home',    'Eat from Home',     'Bring or make your own lunch instead of buying.',    'behavioral', 75,  '🥙'),
  ('daily_review_goal',   'Goal Visualisation','Open a savings goal and visualise achieving it.',    'behavioral', 50,  '👁️'),
  ('daily_save_20',       'Save R20',          'Log at least R20 in savings today.',                 'savings',    100, '🪙'),
  ('daily_no_delivery',   'No Delivery Today', 'No food delivery apps today. Cook or prep instead.', 'behavioral', 75,  '🚫')
ON CONFLICT (id) DO NOTHING;


-- ── weekly_quests seed (8) ─────────────────────────────────────
INSERT INTO public.weekly_quests (id, title, description, category, xp_reward, icon) VALUES
  ('weekly_no_takeout',     'No Takeout Week',         'Zero takeout or food delivery for 7 days.',           'behavioral', 400, '🥗'),
  ('weekly_save_50_daily',  'Save R50 Daily',          'Log at least R50 every day this week.',               'savings',    500, '📅'),
  ('weekly_no_shopping',    'No Shopping Week',        'No non-essential purchases for 7 days.',              'behavioral', 450, '🛒'),
  ('weekly_save_500',       'Save R500',               'Log a total of R500 in savings this week.',           'savings',    500, '💵'),
  ('weekly_7_checkins',     'Perfect Attendance',      'Complete a daily quest every single day this week.', 'streak',     600, '✅'),
  ('weekly_coffee_ban',     'Coffee Blackout',         'No bought coffee for 5 days. Brew at home.',          'behavioral', 300, '☕'),
  ('weekly_round_up',       'Round-Up Week',           'Every time you spend, log the round-up as savings.',  'savings',    350, '🎯'),
  ('weekly_weekend_freeze', 'Weekend Spending Freeze', 'Zero non-essential spending Saturday and Sunday.',    'behavioral', 350, '❄️')
ON CONFLICT (id) DO NOTHING;


-- ── quest_chains seed (6) ──────────────────────────────────────
INSERT INTO public.quest_chains (id, title, description, icon, completion_xp, completion_badge_id) VALUES
  ('chain_starter_saver',  'Starter Saver',           'Your first steps as a saver. Build the foundation.', '🌱', 500,  'chain_starter'),
  ('chain_no_spend_hero',  'No-Spend Hero',           'Master the art of not spending.',                     '🙅', 750,  'no_takeout'),
  ('chain_savings_sprint', 'Savings Sprint',          'Build momentum by saving consistently for 2 weeks.', '🏃', 1000, NULL),
  ('chain_emergency_fund', 'Emergency Fund Initiate', 'Build your financial safety net step by step.',       '🛡️', 1500, NULL),
  ('chain_habit_master',   'Habit Master',            'Science says 66 days makes a habit. Prove it.',       '🧠', 3000, 'streak_66'),
  ('chain_goal_crusher',   'Goal Crusher',            'Set goals. Crush them. Repeat.',                      '🎯', 2000, NULL)
ON CONFLICT (id) DO NOTHING;


-- ── quest_chain_steps seed ───────────────────────────────────
INSERT INTO public.quest_chain_steps (chain_id, step_number, title, description, xp_reward, requires_type, requires_value, requires_quest_id) VALUES
  -- chain_starter_saver
  ('chain_starter_saver', 1, 'Open the App',   'Log into SaveQuest for the first time.', 50,  'open_app',       1, NULL),
  ('chain_starter_saver', 2, 'Create a Goal',  'Set up your very first savings goal.',   75,  'complete_daily', 1, NULL),
  ('chain_starter_saver', 3, 'First Deposit',  'Log your first saving of any amount.',   100, 'save_amount',    1, NULL),
  ('chain_starter_saver', 4, '3-Day Streak',   'Stay active 3 days in a row.',            150, 'streak',         3, NULL),
  ('chain_starter_saver', 5, 'First Quest',    'Complete any daily quest.',               150, 'complete_daily', 1, NULL),

  -- chain_no_spend_hero
  ('chain_no_spend_hero', 1, 'Skip an Impulse', 'Complete the Skip One Impulse daily quest.', 100, 'complete_quest', 1, 'daily_skip_purchase'),
  ('chain_no_spend_hero', 2, 'No-Delivery Day', 'Complete No Delivery Today daily quest.',    100, 'complete_quest', 1, 'daily_no_delivery'),
  ('chain_no_spend_hero', 3, 'Weekend Freeze',  'Complete Weekend Spending Freeze.',          200, 'complete_quest', 1, 'weekly_weekend_freeze'),
  ('chain_no_spend_hero', 4, 'No Takeout Week', 'Complete No Takeout Week.',                  300, 'complete_quest', 1, 'weekly_no_takeout'),

  -- chain_savings_sprint
  ('chain_savings_sprint', 1, 'Save R50',     'Log R50 in total savings.',          75,  'save_amount', 50,   NULL),
  ('chain_savings_sprint', 2, 'Save R200',    'Log R200 in total savings.',         100, 'save_amount', 200,  NULL),
  ('chain_savings_sprint', 3, 'Save R500',    'Log R500 in total savings.',         150, 'save_amount', 500,  NULL),
  ('chain_savings_sprint', 4, '7-Day Streak', 'Keep your streak alive for 7 days.', 200, 'streak',      7,    NULL),
  ('chain_savings_sprint', 5, 'Save R1,000',  'Log R1,000 in total savings.',       300, 'save_amount', 1000, NULL),

  -- chain_emergency_fund
  ('chain_emergency_fund', 1, 'Create Emergency Goal', 'Set up an Emergency Fund goal.',        100, 'complete_daily', 1,    NULL),
  ('chain_emergency_fund', 2, 'First R500',            'Save R500 toward your emergency fund.', 200, 'save_amount',    500,  NULL),
  ('chain_emergency_fund', 3, 'Stay Consistent',       'Maintain a 14-day streak.',             300, 'streak',         14,   NULL),
  ('chain_emergency_fund', 4, 'Reach R1,000',          'Save R1,000 total.',                    400, 'save_amount',    1000, NULL),
  ('chain_emergency_fund', 5, 'Complete the Fund',     'Fully complete your emergency goal.',   500, 'complete_quest', 1,    NULL),

  -- chain_habit_master
  ('chain_habit_master', 1, '7-Day Streak',  'Active for 7 consecutive days.',    300,  'streak', 7,  NULL),
  ('chain_habit_master', 2, '21-Day Streak', 'Active for 21 consecutive days.',   700,  'streak', 21, NULL),
  ('chain_habit_master', 3, '30-Day Streak', 'Active for 30 consecutive days.',   1000, 'streak', 30, NULL),
  ('chain_habit_master', 4, '66-Day Streak', '66 days — the habit is hardwired.', 2000, 'streak', 66, NULL),

  -- chain_goal_crusher
  ('chain_goal_crusher', 1, 'First Goal Complete',  'Complete any savings goal.',        500, 'complete_quest', 1, NULL),
  ('chain_goal_crusher', 2, 'Second Goal Complete', 'Complete a second savings goal.',   600, 'complete_quest', 2, NULL),
  ('chain_goal_crusher', 3, 'Third Goal Complete',  'Three goals down. You''re on fire.',700, 'complete_quest', 3, NULL)
ON CONFLICT (chain_id, step_number) DO NOTHING;
