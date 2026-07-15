-- ─────────────────────────────────────────────────────────────────────────────
-- 054_down.sql
-- Rollback for 054_privacy_system.sql
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_user_achievements(UUID);
DROP FUNCTION IF EXISTS public.share_any_group(UUID, UUID);

ALTER TABLE public.user_achievements DROP CONSTRAINT IF EXISTS user_achievements_visibility_check;
ALTER TABLE public.user_achievements ADD CONSTRAINT user_achievements_visibility_check
  CHECK (visibility IS NULL OR visibility IN ('private', 'friends', 'public'));
