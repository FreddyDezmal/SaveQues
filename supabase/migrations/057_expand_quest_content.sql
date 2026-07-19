-- 044_expand_quest_content.sql
--
-- Adds new daily quests, weekly quests, seasonal/evergreen challenges,
-- events, and quest chains, per user request. Written with the admin CRUD
-- audit's findings in mind (docs/ADMIN_CRUD_AUDIT.md):
--
--   • daily_quests / weekly_quests: the live rotation shown to users
--     comes from hardcoded DAILY_QUESTS / WEEKLY_QUESTS arrays in
--     lib/quests.ts (already updated to match, same commit), but
--     app/api/quest/daily+weekly/complete/route.ts look the quest up in
--     these DB tables before awarding XP. Every id inserted here has an
--     exact matching entry in lib/quests.ts — this is the same class of
--     mismatch that caused the 404s fixed earlier, avoided here by
--     construction (checked with a script before writing this file).
--
--   • challenges / events: these are genuinely DB-native already (no
--     hardcoded parallel array), so new rows here are immediately live
--     and admin-editable — no code changes needed for these two.
--
--   • quest_chains / quest_chain_steps: gameplay reads the hardcoded
--     QUEST_CHAINS constant in lib/quests.ts (already updated, same
--     commit) — these DB rows are catalog/display data only (per the
--     audit's warning banner in the admin UI), seeded here purely so the
--     admin Chains tab isn't misleadingly incomplete relative to what's
--     actually playable. completion_badge_id is left NULL for the new
--     chains rather than inventing a matching (also-decorative) badge row.
--
-- All inserts use ON CONFLICT (id) DO NOTHING — safe to re-run.

-- ── New daily quests (7 new — matches lib/quests.ts DAILY_QUESTS) ──────────
INSERT INTO public.daily_quests (id, title, description, category, xp_reward, icon, requirement_type, requirement_value) VALUES
  ('daily_save_10',       'Save R10',            'Log at least R10 in savings today — every bit counts.', 'savings',    60, '🪙', 'save_amount', 10),
  ('daily_round_up',      'Round It Up',         'Round up a purchase today and save the difference.',    'savings',    75, '🔄', 'none', 0),
  ('daily_streak_guard',  'Protect Your Streak', 'Make sure today counts — keep your streak alive.',      'streak',     60, '🛡️', 'streak', 1),
  ('daily_price_compare', 'Price Check',         'Compare prices somewhere before you buy today.',        'behavioral', 60, '🔍', 'none', 0),
  ('daily_no_spend_hour', 'Golden Hour',         'Go one full hour today without spending anything.',     'behavioral', 50, '⏳', 'none', 0),
  ('daily_budget_check',  'Budget Glance',       'Check today''s spending against your plan.',            'behavioral', 50, '📊', 'none', 0)
ON CONFLICT (id) DO NOTHING;

-- ── New weekly quests (6 new — matches lib/quests.ts WEEKLY_QUESTS) ────────
INSERT INTO public.weekly_quests (id, title, description, category, xp_reward, icon, requirement_type, requirement_value) VALUES
  ('weekly_save_1000',       'Save R1,000',           'Log a total of R1,000 in savings this week.',           'savings',    700, '💎', 'save_amount', 1000),
  ('weekly_goal_progress',   'Goal Momentum',         'Make progress on a goal at least 3 times this week.',   'savings',    400, '📈', 'none', 0),
  ('weekly_no_subscriptions','Subscription Audit',    'Review your subscriptions and cancel one you don''t use.', 'behavioral', 300, '📴', 'none', 0),
  ('weekly_meal_prep',       'Meal Prep Week',        'Prep meals at home instead of eating out, 5+ days.',    'behavioral', 400, '🍱', 'none', 0),
  ('weekly_streak_7',        'Full Week Streak',      'Keep your streak alive for all 7 days this week.',      'streak',     500, '🔥', 'streak', 7),
  ('weekly_double_deposit',  'Double Down',           'Make at least 2 deposits on 3+ different days this week.', 'savings', 450, '💪', 'none', 0)
ON CONFLICT (id) DO NOTHING;

-- ── New evergreen (manual) challenges ───────────────────────────────────────
INSERT INTO public.challenges (title, description, type, xp_reward, duration_days, quest_type, preview_days) VALUES
  ('Digital Detox Weekend', 'Avoid online shopping apps for a full weekend.',              'manual', 200, 2, 'evergreen', 2),
  ('Cash Only Week',        'Use only cash or debit — no credit — for a full week.',       'manual', 350, 7, 'evergreen', 2)
ON CONFLICT DO NOTHING;

-- ── New seasonal / annual challenges ────────────────────────────────────────
-- Dates are illustrative 2026 anchors; year_agnostic = TRUE means the
-- month/day repeats every year regardless of the exact year stored here
-- (same convention as the existing Black Friday / New Year entries).
INSERT INTO public.challenges (title, description, type, xp_reward, duration_days, quest_type, start_date, end_date, year_agnostic, preview_days) VALUES
  ('Spring Clean Your Spending', 'Audit and trim your recurring expenses this month.',        'seasonal', 400, 30, 'seasonal',     '2026-03-01', '2026-03-31', TRUE, 7),
  ('Back to School Budget',      'Save toward school or course costs before term starts.',    'seasonal', 500, 30, 'seasonal',     '2026-01-01', '2026-01-31', TRUE, 7),
  ('Valentine''s Budget Challenge','Celebrate without overspending — set a Valentine''s budget and stick to it.', 'seasonal', 300, 7, 'annual_event', '2026-02-08', '2026-02-14', TRUE, 5),
  ('Mid-Year Money Reset',       'Review your goals and reset your saving pace at the year''s midpoint.', 'seasonal', 400, 14, 'seasonal', '2026-06-15', '2026-06-29', TRUE, 7),
  ('Heritage Month Save',        'Build your fund during Heritage Month.',                     'seasonal', 400, 30, 'seasonal',     '2026-09-01', '2026-09-30', TRUE, 7),
  ('Festive Season Firewall',    'Protect your savings through the festive spending season.', 'seasonal', 600, 45, 'seasonal',     '2026-11-15', '2026-12-31', TRUE, 10)
ON CONFLICT DO NOTHING;

-- ── New events ───────────────────────────────────────────────────────────
INSERT INTO public.events (slug, title, description, emoji, event_type, xp_reward, available_from, available_until, is_annual, preview_days) VALUES
  ('evt_new_year_kickoff',    'New Year Kickoff',        'Start the year strong — log a deposit in the first week of January.', '🎉', 'savequest', 500, '2026-01-01', '2026-01-07', TRUE,  7),
  ('evt_savings_marathon',    '30-Day Savings Marathon', 'Log a deposit every day for 30 days straight.',                       '🏅', 'savequest', 800, NULL,         NULL,         FALSE, 3),
  ('evt_streak_challenge_month','Streak Challenge Month','A whole month dedicated to building your streak.',                    '🔥', 'savequest', 450, NULL,         NULL,         FALSE, 5),
  ('evt_flash_save_friday',   'Flash Save Friday',       'Every Friday deposit this month earns bonus XP.',                     '⚡', 'savequest', 250, NULL,         NULL,         FALSE, 0)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.event_regions (event_id, region)
SELECT id, 'GLOBAL' FROM public.events
WHERE slug IN ('evt_new_year_kickoff', 'evt_savings_marathon', 'evt_streak_challenge_month', 'evt_flash_save_friday')
ON CONFLICT DO NOTHING;

-- ── New quest chains (catalog/display only — see header note) ─────────────
INSERT INTO public.quest_chains (id, title, description, icon, completion_xp) VALUES
  ('chain_century_saver',        'Century Saver',           'Big milestones, one deposit at a time.',              '💯', 2500),
  ('chain_consistency_champion', 'Consistency Champion',    'Show up, week after week, and let it add up.',        '🏆', 1800)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.quest_chain_steps (chain_id, step_number, title, description, xp_reward, requires_type, requires_value, requires_quest_id) VALUES
  ('chain_century_saver', 1, 'Save R2,000',  'Log R2,000 in total savings.',                  300,  'save_amount',    2000,  NULL),
  ('chain_century_saver', 2, 'Save R5,000',  'Log R5,000 in total savings.',                  500,  'save_amount',    5000,  NULL),
  ('chain_century_saver', 3, 'Save R10,000', 'Log R10,000 in total savings.',                 700,  'save_amount',    10000, NULL),
  ('chain_century_saver', 4, 'Save R25,000', 'Log R25,000 in total savings.',                 900,  'save_amount',    25000, NULL),
  ('chain_century_saver', 5, 'Save R50,000', 'Log R50,000 in total savings — a huge milestone.', 1200, 'save_amount',  50000, NULL),

  ('chain_consistency_champion', 1, '10-Day Streak',      'Active for 10 consecutive days.',              250, 'streak',         10, NULL),
  ('chain_consistency_champion', 2, 'Perfect Attendance', 'Complete Perfect Attendance weekly quest.',    400, 'complete_quest', 1,  'weekly_7_checkins'),
  ('chain_consistency_champion', 3, '45-Day Streak',      'Active for 45 consecutive days.',              600, 'streak',         45, NULL),
  ('chain_consistency_champion', 4, 'Ten Daily Quests',   'Complete 10 daily quests in total.',           550, 'complete_daily', 10, NULL)
ON CONFLICT (chain_id, step_number) DO NOTHING;
