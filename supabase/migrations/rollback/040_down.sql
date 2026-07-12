-- 038_down.sql
-- Rollback for 038_quest_requirement_criteria.sql
ALTER TABLE public.daily_quests
  DROP COLUMN IF EXISTS requirement_type,
  DROP COLUMN IF EXISTS requirement_value;

ALTER TABLE public.weekly_quests
  DROP COLUMN IF EXISTS requirement_type,
  DROP COLUMN IF EXISTS requirement_value;
