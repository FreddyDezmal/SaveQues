-- 042_down.sql
-- Rollback for 042_reseed_quest_catalog.sql
--
-- CAUTION: this is a data-seed migration, not a schema change — a true,
-- lossless rollback isn't possible because 042 uses
-- ON CONFLICT (id) DO NOTHING, so we have no record of which of these
-- rows already existed before it ran vs. which it actually inserted.
--
-- This DELETE removes the specific catalog rows 042 seeds, which is safe
-- with respect to referential integrity (daily_quest_logs.quest_id and
-- user_weekly_quests.quest_id are plain TEXT columns with no foreign key
-- to these tables — confirmed via grep across all migrations), so it
-- won't cascade or break historical completion logs. But if any of these
-- rows genuinely existed before 042 ran (the normal, expected case — they
-- were supposed to be seeded by migration 016), this rollback removes
-- them too, which is very likely NOT what you want.
--
-- Only run this if you're certain none of these quest ids should exist
-- (e.g. you're deliberately removing the default quest catalog). The
-- is_active flip 042 made is not reversible here since prior per-row
-- state wasn't recorded.

DELETE FROM public.daily_quests WHERE id IN (
  'daily_checkin','daily_save_any','daily_skip_purchase','daily_lunch_home',
  'daily_review_goal','daily_save_20','daily_no_delivery'
);

DELETE FROM public.weekly_quests WHERE id IN (
  'weekly_no_takeout','weekly_save_50_daily','weekly_no_shopping','weekly_save_500',
  'weekly_7_checkins','weekly_coffee_ban','weekly_round_up','weekly_weekend_freeze'
);
