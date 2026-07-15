-- ─────────────────────────────────────────────────────────────────────────────
-- 050_down.sql
-- Rollback for 050_group_quests.sql
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.service_complete_group_quest(UUID);
DROP FUNCTION IF EXISTS public.compute_group_quest_progress(UUID);
DROP FUNCTION IF EXISTS public.group_quest_raw_progress(UUID);

ALTER TABLE public.xp_awards DROP CONSTRAINT IF EXISTS xp_awards_source_type_check;
ALTER TABLE public.xp_awards ADD CONSTRAINT xp_awards_source_type_check
  CHECK (source_type IN (
    'daily_quest','weekly_quest','challenge','chain_step',
    'chain_complete','log_saving','goal_complete',
    'event_complete','achievement','admin_grant','daily_checkin'
  ));
