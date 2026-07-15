-- 042_reseed_quest_catalog.sql
--
-- Diagnostic context: after migration 038 shipped (adding
-- requirement_type/requirement_value to daily_quests/weekly_quests),
-- app/api/quest/daily/complete/route.ts started returning 404 for a
-- previously-working quest. The code was first fixed to stop masking a
-- *query error* as "not found" (see that route's comments) — but the 404
-- is still happening after that fix, which means the query is succeeding
-- and genuinely finding no row: the live daily_quests/weekly_quests
-- tables are missing rows that migration 016 was supposed to have seeded.
--
-- This migration re-applies exactly migration 016's seed data for
-- daily_quests and weekly_quests (nothing else — no table creation, no
-- other seed data), using ON CONFLICT (id) DO NOTHING so it's 100% safe
-- to run regardless of whether some/none/all of these rows already exist.
-- It will not overwrite or duplicate anything.
--
-- Run this directly against your Supabase project (SQL editor or CLI) —
-- writing this file does not, by itself, apply it anywhere.

INSERT INTO public.daily_quests (id, title, description, category, xp_reward, icon) VALUES
  ('daily_checkin',       'Daily Check-In',    'Open SaveQuest and review your goals today.',        'behavioral', 75,  '📱'),
  ('daily_save_any',      'Save Something',    'Log any saving today, no matter how small.',         'savings',    100, '💰'),
  ('daily_skip_purchase', 'Skip One Impulse',  'Identify one impulse purchase you skipped today.',   'behavioral', 75,  '🙅'),
  ('daily_lunch_home',    'Eat from Home',     'Bring or make your own lunch instead of buying.',    'behavioral', 75,  '🥙'),
  ('daily_review_goal',   'Goal Visualisation','Open a savings goal and visualise achieving it.',    'behavioral', 50,  '👁️'),
  ('daily_save_20',       'Save R20',          'Log at least R20 in savings today.',                 'savings',    100, '🪙'),
  ('daily_no_delivery',   'No Delivery Today', 'No food delivery apps today. Cook or prep instead.', 'behavioral', 75,  '🚫')
ON CONFLICT (id) DO NOTHING;

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

-- Belt-and-braces: make sure none of the 6 quests the frontend can
-- actually pick today (lib/quests.ts DAILY_QUESTS) are sitting disabled —
-- an admin toggling one off would also produce this exact 404.
UPDATE public.daily_quests SET is_active = TRUE
WHERE id IN ('daily_checkin','daily_save_any','daily_skip_purchase','daily_lunch_home','daily_review_goal','daily_no_delivery')
  AND is_active = FALSE;
