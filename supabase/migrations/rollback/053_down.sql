-- ─────────────────────────────────────────────────────────────────────────────
-- 053_down.sql
-- Rollback for 053_invitations.sql
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.redeem_invite(TEXT);
DROP FUNCTION IF EXISTS public.get_invite_preview(TEXT);
DROP TABLE IF EXISTS public.invitations;
DROP FUNCTION IF EXISTS public.enforce_invite_permissions();

ALTER TABLE public.xp_awards DROP CONSTRAINT IF EXISTS xp_awards_source_type_check;
ALTER TABLE public.xp_awards ADD CONSTRAINT xp_awards_source_type_check
  CHECK (source_type IN (
    'daily_quest','weekly_quest','challenge','chain_step',
    'chain_complete','log_saving','goal_complete',
    'event_complete','achievement','admin_grant','daily_checkin',
    'group_quest'
  ));
