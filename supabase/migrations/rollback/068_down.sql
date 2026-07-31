-- ─────────────────────────────────────────────────────────────────────────────
-- 068_down.sql
-- Rollback for 068_security_advisor_hardening.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Reverts search_path back to mutable (Postgres default) and re-grants
-- EXECUTE on the internal-only functions to PUBLIC (which anon/authenticated
-- inherit from), restoring the exact state the Supabase linter originally
-- flagged. There is no functional reason to run this — it exists only so a
-- bad interaction discovered after deploying 068 (e.g. a trigger that
-- unexpectedly did need direct EXECUTE for some reason not caught by this
-- migration's audit) has a fast, safe way back, without guessing at what
-- the "before" grants actually were.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER FUNCTION public.handle_new_user() RESET search_path;
ALTER FUNCTION public.update_goal_amount() RESET search_path;
ALTER FUNCTION public.set_updated_at() RESET search_path;
ALTER FUNCTION public.record_app_open(UUID) RESET search_path;
ALTER FUNCTION public.cleanup_old_rate_limit_attempts() RESET search_path;
ALTER FUNCTION public.cleanup_old_request_outcomes() RESET search_path;
ALTER FUNCTION public.cleanup_old_dashboard_timings() RESET search_path;
ALTER FUNCTION public.set_notification_preferences_updated_at() RESET search_path;

DO $$
DECLARE
  fn TEXT;
  internal_only_functions TEXT[] := ARRAY[
    'enforce_accountability_transition()',
    'enforce_block_ownership()',
    'enforce_contribution_membership()',
    'enforce_group_member_transition()',
    'enforce_invite_permissions()',
    'enforce_shared_goal_member_transition()',
    'enforce_shared_goal_ownership()',
    'enforce_single_accountability_partner()',
    'enforce_transaction_goal_ownership()',
    'enforce_withdrawal_balance()',
    'feed_on_achievement_unlocked()',
    'feed_on_goal_completed()',
    'feed_on_group_joined()',
    'feed_on_group_quest_completed()',
    'feed_on_streak_milestone()',
    'handle_new_group()',
    'trg_refresh_engagement_status()',
    'update_goal_amount()',
    'group_quest_raw_progress(UUID)',
    'increment_group_xp(UUID, INTEGER)',
    'log_activity(UUID, INTEGER, DATE)',
    'post_activity_feed_event(UUID, UUID, TEXT, JSONB, TEXT)',
    'record_checkin(UUID, DATE, INTEGER)',
    'share_any_group(UUID, UUID)',
    'update_streak(UUID)',
    'cleanup_old_dashboard_timings()',
    'cleanup_old_rate_limit_attempts()',
    'cleanup_old_request_outcomes()',
    'get_friend_profile(UUID)'
  ];
BEGIN
  FOREACH fn IN ARRAY internal_only_functions LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO PUBLIC', fn);
  END LOOP;
END $$;
