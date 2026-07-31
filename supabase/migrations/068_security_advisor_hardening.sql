-- ─────────────────────────────────────────────────────────────────────────────
-- 068_security_advisor_hardening.sql
-- Fixes findings from a Supabase database linter (security advisor) report
-- reviewed 2026-07-29. NOT part of Sprint 28 — a separate, pre-existing
-- security posture pass. See the companion audit note below for how each
-- category was verified (not just pattern-matched from the linter output).
--
-- ══════════════════════════════════════════════════════════════════════════
-- PART A — function_search_path_mutable (7 functions)
-- ══════════════════════════════════════════════════════════════════════════
-- A function without a fixed `search_path` resolves unqualified identifiers
-- (table/type names) against whatever search_path the CALLING session
-- happens to have. For a SECURITY DEFINER function this is a real
-- privilege-escalation vector: a caller could craft a same-named object
-- earlier in their session's search_path to have the function operate on
-- attacker-controlled objects instead of the real ones. Every function
-- below already fully-qualifies its own table references (public.profiles,
-- etc. — verified by reading each definition), so this is defense-in-depth
-- rather than a fix for an active exploit, but it's a one-line, zero-behavior-
-- change fix, so there's no reason not to close it.
--
-- `SET search_path = ''` (empty) is used, not `= public`, per Supabase's
-- own current guidance — an empty search_path forces every reference to be
-- schema-qualified, which is already true of every function touched here.
-- ══════════════════════════════════════════════════════════════════════════

ALTER FUNCTION public.handle_new_user() SET search_path = '';
ALTER FUNCTION public.update_goal_amount() SET search_path = '';
ALTER FUNCTION public.set_updated_at() SET search_path = '';
ALTER FUNCTION public.record_app_open(UUID) SET search_path = '';
ALTER FUNCTION public.cleanup_old_rate_limit_attempts() SET search_path = '';
ALTER FUNCTION public.cleanup_old_request_outcomes() SET search_path = '';
ALTER FUNCTION public.cleanup_old_dashboard_timings() SET search_path = '';
ALTER FUNCTION public.set_notification_preferences_updated_at() SET search_path = '';

-- ══════════════════════════════════════════════════════════════════════════
-- PART B — excess anon/authenticated EXECUTE on internal-only functions
-- ══════════════════════════════════════════════════════════════════════════
-- AUDIT METHOD (not guessed): every SECURITY DEFINER function flagged by the
-- linter was checked against (1) every `.rpc(...)` call site in app/,
-- components/, and lib/ — the only way this app's client or server code
-- actually invokes a Postgres function — and (2) every CREATE POLICY
-- USING/WITH CHECK clause and CREATE TRIGGER statement across
-- supabase/migrations/, since RLS policies and triggers can depend on a
-- function without ever appearing as a `.rpc()` call.
--
-- The ~35 functions genuinely called via `.rpc()` (get_dashboard_data,
-- award_xp, complete_daily_quest, leaderboard_*, etc.) are untouched here —
-- spot-checked a sample (award_xp, purchase_shield, get_friend_profile) and
-- confirmed each validates `auth.uid() = p_user_id` (or an equivalent
-- ownership/relationship check) internally before doing anything, which is
-- the actual mitigation for a function callable by `authenticated` — the
-- linter's WARN fires on any SECURITY DEFINER + exposed combination
-- regardless of internal checks, so it can't distinguish these from a
-- genuinely open function.
--
-- Four functions used directly inside CREATE POLICY clauses —
-- are_friends, can_view_activity_row, can_view_shared_goal,
-- user_group_role — are ALSO untouched. Revoking EXECUTE from
-- `authenticated` on these would break RLS itself: Postgres requires the
-- querying role to hold EXECUTE on any function referenced inside a
-- policy expression, independent of whether that role ever calls the
-- function directly. This is confirmed by grep against every migration
-- file (activity_feed_select_by_visibility, shared_goals RLS, groups RLS)
-- — not assumed.
--
-- Two functions (group_quest_raw_progress, post_activity_feed_event)
-- already had a REVOKE in migrations 050/051 — but only `FROM PUBLIC` and
-- `FROM authenticated`, never `FROM anon` explicitly. Supabase's default
-- privileges grant `anon` and `authenticated` EXECUTE independently at
-- function creation time, not merely via inherited PUBLIC access, so
-- omitting `anon` left it reachable — which is exactly why the linter
-- still flags group_quest_raw_progress today despite that prior fix. Every
-- REVOKE below explicitly names PUBLIC, anon, AND authenticated, closing
-- that gap for good rather than repeating it.
--
-- Everything else in this section is either:
--   - a trigger function (enforce_*, feed_on_*, handle_new_group,
--     trg_refresh_engagement_status) — trigger firing is not gated by the
--     invoking role's EXECUTE privilege at all (confirmed: every one has a
--     matching CREATE TRIGGER ... EXECUTE FUNCTION in its own migration),
--     so revoking direct REST-API callability has zero effect on the
--     triggers themselves still firing correctly, or
--   - an internal helper called only from inside another SECURITY DEFINER
--     function's body (share_any_group, increment_group_xp,
--     get_friend_profile is the one exception — see below), which likewise
--     doesn't need the original caller's own EXECUTE grant, since a
--     SECURITY DEFINER function's internal calls run under ITS owner's
--     privileges, or
--   - a service-role-only maintenance function (the three cleanup_* /
--     cron functions) never meant to be called by any interactive role.
--
-- get_friend_profile is the one exception in this section that IS a public
-- read-style RPC (returns a limited profile shape) rather than a trigger —
-- but it was never wired into any `.rpc()` call anywhere in the app. Reading
-- its own body confirms it already guards correctly (auth.uid() required,
-- returns nothing unless caller is the target or a confirmed friend), so
-- this isn't a vulnerability fix so much as closing an unused surface —
-- shipped in migration 046 for a feature that evidently isn't wired up in
-- the UI yet. Revoking now costs nothing; if/when a "view friend profile"
-- screen is built, grant EXECUTE back to `authenticated` in that same PR.
-- ══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  fn TEXT;
  internal_only_functions TEXT[] := ARRAY[
    -- Trigger functions (fire regardless of EXECUTE grants — see note above)
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
    -- Internal helpers, never called directly by app code or RLS policies
    'group_quest_raw_progress(UUID)',
    'increment_group_xp(UUID, INTEGER)',
    'log_activity(UUID, INTEGER, DATE)',
    'post_activity_feed_event(UUID, UUID, TEXT, JSONB, TEXT)',
    'record_checkin(UUID, DATE, INTEGER)',
    'share_any_group(UUID, UUID)',
    'update_streak(UUID)',
    -- Service-role-only maintenance/cron functions
    'cleanup_old_dashboard_timings()',
    'cleanup_old_rate_limit_attempts()',
    'cleanup_old_request_outcomes()',
    -- Shipped but not yet wired into any UI (see note above)
    'get_friend_profile(UUID)'
  ];
BEGIN
  FOREACH fn IN ARRAY internal_only_functions LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
  END LOOP;
END $$;

-- handle_new_user() is deliberately NOT in the list above, unlike its
-- sibling handle_new_group(). Every other trigger function's `CREATE
-- TRIGGER ... EXECUTE FUNCTION` is visible in supabase/migrations/ (grepped
-- and confirmed for each one before adding it to the array), but
-- handle_new_user's trigger — the classic Supabase "on new auth.users row,
-- create a profile" pattern — is only referenced in a comment (migration
-- 045) and never defined via a tracked CREATE TRIGGER statement in this
-- repo. That most likely means it was created directly against the
-- `auth` schema outside the app's own migrations (auth.users isn't owned
-- by this project's migration history the way public.* is), which this
-- audit has no visibility into. Rather than guess, this migration only
-- applies the safe, behavior-neutral search_path fix (Part A) to
-- handle_new_user and leaves its EXECUTE grants exactly as they are —
-- confirm the trigger definition directly in the Supabase dashboard
-- (Database → Triggers, on auth.users) before deciding whether it's also
-- safe to revoke here.

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================
-- Search-path fix — expect all 8 rows back with proconfig containing search_path=:
--   SELECT proname, proconfig FROM pg_proc
--     WHERE pronamespace = 'public'::regnamespace
--       AND proname IN ('handle_new_user','update_goal_amount','set_updated_at',
--         'record_app_open','cleanup_old_rate_limit_attempts',
--         'cleanup_old_request_outcomes','cleanup_old_dashboard_timings',
--         'set_notification_preferences_updated_at');
--
-- Revoke verification — expect FALSE for every row:
--   SELECT has_function_privilege('anon', 'public.handle_new_group()', 'EXECUTE');
--   SELECT has_function_privilege('authenticated', 'public.group_quest_raw_progress(uuid)', 'EXECUTE');
--
-- Regression check — confirm triggers still fire (should still succeed):
--   run the existing integration test suite's signup/goal/group flows, or
--   manually sign up a test user and confirm handle_new_user's profile row
--   is still created.
-- ============================================================
