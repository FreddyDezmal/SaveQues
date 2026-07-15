-- ─────────────────────────────────────────────────────────────────────────────
-- 050_group_quests.sql
-- Sprint 22, Phase 7 — Group quests
--
-- Wraps, does not replace, the existing quest/XP system (group_quests
-- itself was already created in 045 — this migration is the completion
-- logic that was deliberately deferred until Phase 7).
--
-- ── Why this can't just call award_xp() ────────────────────────────────
-- lib/awardXP.ts / public.award_xp() (042_award_xp_allowlist.sql) has a
-- hard C1 guard: `IF p_user_id <> auth.uid() THEN RAISE EXCEPTION
-- 'forbidden'`. That's correct and load-bearing — it's what stops any
-- authenticated session from awarding XP to an arbitrary other user. But
-- it also means award_xp() structurally CANNOT be used to award XP to a
-- whole group of people as a result of ONE member's action (e.g.
-- whoever's browser happens to trigger "check if this quest is done").
-- Every existing XP path in this codebase only ever awards to
-- auth.uid() themselves — group quest completion is the first genuine
-- exception, and 042's own comment names the correct fix rather than
-- leaving it to guesswork: "move XP-awarding calls behind a service-role
-- trust boundary the browser can never reach." That's exactly what PART C
-- does: service_complete_group_quest() is REVOKEd from authenticated
-- entirely (same lockdown pattern as upsert_daily_activity /
-- update_engagement_status in 018_c1_rpc_privilege_escalation_fix.sql)
-- and is only ever invoked from a Next.js API route using the
-- service-role Supabase client — never directly from a browser session.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- PART A — xp_awards: allow 'group_quest' as a source_type
-- ═══════════════════════════════════════════════════════════════════════════
-- Same drop-and-recreate pattern 015_momentum_activity_fix.sql used to add
-- 'daily_checkin'. Deliberately NOT added to award_xp()'s internal
-- allowlist (042) — group quest XP is never granted through award_xp() at
-- all (see file header), so extending that allowlist would just be dead
-- code suggesting a path that doesn't exist.

ALTER TABLE public.xp_awards DROP CONSTRAINT IF EXISTS xp_awards_source_type_check;
ALTER TABLE public.xp_awards ADD CONSTRAINT xp_awards_source_type_check
  CHECK (source_type IN (
    'daily_quest','weekly_quest','challenge','chain_step',
    'chain_complete','log_saving','goal_complete',
    'event_complete','achievement','admin_grant','daily_checkin',
    'group_quest'
  ));


-- ═══════════════════════════════════════════════════════════════════════════
-- PART B — Shared progress computation (single source of truth)
-- ═══════════════════════════════════════════════════════════════════════════
-- Internal helper — NOT granted to authenticated. Both the public preview
-- RPC (compute_group_quest_progress) and the service-role completion RPC
-- (service_complete_group_quest) call this so there is exactly one place
-- that defines "what counts as progress," rather than two computations
-- that could quietly drift out of sync with each other.
--
-- Reads public.transactions (RLS-locked to auth.uid() = user_id) across
-- every active member of the quest's group — a read, never a write,
-- consistent with "money logic is read-only." Only aggregate figures are
-- computed here; which fields the caller is allowed to actually SEE is
-- decided by whichever wrapper calls this, not by this function.
CREATE OR REPLACE FUNCTION public.group_quest_raw_progress(p_group_quest_id UUID)
RETURNS TABLE (
  quest_group_id        UUID,
  quest_type            TEXT,
  target_value          NUMERIC,
  start_date            DATE,
  end_date              DATE,
  quest_status          TEXT,
  xp_reward             INTEGER,
  member_count          INTEGER,
  participated_count    INTEGER,
  total_deposit_count   INTEGER,
  total_deposit_amount  NUMERIC,
  is_condition_met      BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_quest       RECORD;
  v_member_ct   INTEGER;
  v_participated INTEGER;
  v_dep_count   INTEGER;
  v_dep_amount  NUMERIC;
  v_met         BOOLEAN;
BEGIN
  SELECT * INTO v_quest FROM public.group_quests WHERE id = p_group_quest_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_member_ct
  FROM public.group_members
  WHERE group_id = v_quest.group_id AND status = 'active';

  SELECT count(DISTINCT t.user_id), count(*), COALESCE(SUM(t.amount), 0)
  INTO v_participated, v_dep_count, v_dep_amount
  FROM public.transactions t
  JOIN public.group_members gm
    ON gm.user_id = t.user_id AND gm.group_id = v_quest.group_id AND gm.status = 'active'
  WHERE t.transaction_type = 'deposit'
    AND t.created_at::date BETWEEN v_quest.start_date AND v_quest.end_date;

  v_met := CASE v_quest.quest_type
    WHEN 'everyone_saves_this_week' THEN v_member_ct > 0 AND v_participated >= v_member_ct
    WHEN 'full_participation'       THEN v_member_ct > 0 AND v_participated >= v_member_ct
    WHEN 'deposit_count_together'   THEN v_dep_count  >= COALESCE(v_quest.target_value, 0)
    WHEN 'target_amount_together'   THEN v_dep_amount >= COALESCE(v_quest.target_value, 0)
    ELSE FALSE
  END;

  RETURN QUERY SELECT
    v_quest.group_id, v_quest.quest_type, v_quest.target_value,
    v_quest.start_date, v_quest.end_date, v_quest.status, v_quest.xp_reward,
    v_member_ct, v_participated, v_dep_count, v_dep_amount, v_met;
END;
$$;

REVOKE ALL ON FUNCTION public.group_quest_raw_progress(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.group_quest_raw_progress(UUID) FROM authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART C.1 — Public read-only preview (authenticated, member-gated)
-- ═══════════════════════════════════════════════════════════════════════════
-- No per-member dollar breakdown — only aggregate counts/sums and a
-- boolean per-member "participated" flag would be added by a future
-- per-member view if needed. More conservative than the shared_goals
-- detail RPC (049), which deliberately does show per-member amounts to a
-- small, explicitly-invited contributor set; a group can be larger and
-- less deliberately curated, so this stays aggregate-only.
CREATE OR REPLACE FUNCTION public.compute_group_quest_progress(p_group_quest_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_row    RECORD;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_row FROM public.group_quest_raw_progress(p_group_quest_id);
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF public.user_group_role(v_row.quest_group_id, v_caller) IS NULL THEN
    RETURN NULL; -- not a member — don't confirm the quest exists
  END IF;

  RETURN jsonb_build_object(
    'quest_type', v_row.quest_type,
    'target_value', v_row.target_value,
    'start_date', v_row.start_date,
    'end_date', v_row.end_date,
    'status', v_row.quest_status,
    'xp_reward', v_row.xp_reward,
    'member_count', v_row.member_count,
    'participated_count', v_row.participated_count,
    'total_deposit_count', v_row.total_deposit_count,
    'total_deposit_amount', v_row.total_deposit_amount,
    'is_condition_met', v_row.is_condition_met
  );
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART C.2 — Completion (service_role only — see file header)
-- ═══════════════════════════════════════════════════════════════════════════
-- Idempotent and safe to call repeatedly: a quest already 'completed' or
-- 'expired' is returned as-is with no side effects. Expiry (end_date
-- passed, condition never met) is handled in the same pass so callers
-- don't need a separate cron for it — whichever request happens to check
-- next after end_date naturally settles the status.
--
-- XP is awarded to every currently-active group member directly via
-- xp_awards + profiles.xp_total, replicating what award_xp() does
-- internally but for many users in one pass — this is the "server
-- verified the real event from real data before granting XP" trust path
-- 042's own comment describes, just implemented as a dedicated function
-- instead of threaded through award_xp() (which can't do cross-user
-- awards at all, by design).
CREATE OR REPLACE FUNCTION public.service_complete_group_quest(p_group_quest_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row      RECORD;
  v_member   RECORD;
  v_awarded  UUID[] := '{}';
BEGIN
  SELECT * INTO v_row FROM public.group_quest_raw_progress(p_group_quest_id);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  IF v_row.quest_status <> 'active' THEN
    RETURN jsonb_build_object('completed', v_row.quest_status = 'completed', 'status', v_row.quest_status, 'already_settled', true);
  END IF;

  IF v_row.is_condition_met THEN
    UPDATE public.group_quests SET status = 'completed', completed_at = NOW() WHERE id = p_group_quest_id;

    PERFORM public.increment_group_xp(v_row.quest_group_id, v_row.xp_reward);

    FOR v_member IN
      SELECT user_id FROM public.group_members WHERE group_id = v_row.quest_group_id AND status = 'active'
    LOOP
      INSERT INTO public.xp_awards (user_id, source_type, source_id, xp_awarded)
      VALUES (v_member.user_id, 'group_quest', p_group_quest_id::TEXT, v_row.xp_reward)
      ON CONFLICT (user_id, source_type, source_id) DO NOTHING;

      IF FOUND THEN
        UPDATE public.profiles SET xp_total = xp_total + v_row.xp_reward WHERE id = v_member.user_id;
        v_awarded := array_append(v_awarded, v_member.user_id);
      END IF;
    END LOOP;

    RETURN jsonb_build_object(
      'completed', true, 'status', 'completed',
      'xp_each', v_row.xp_reward, 'members_awarded', to_jsonb(v_awarded)
    );
  END IF;

  IF v_row.end_date < CURRENT_DATE THEN
    UPDATE public.group_quests SET status = 'expired' WHERE id = p_group_quest_id;
    RETURN jsonb_build_object('completed', false, 'status', 'expired');
  END IF;

  RETURN jsonb_build_object(
    'completed', false, 'status', 'active',
    'participated_count', v_row.participated_count, 'member_count', v_row.member_count,
    'total_deposit_count', v_row.total_deposit_count, 'total_deposit_amount', v_row.total_deposit_amount
  );
END;
$$;

-- Locked to service_role only — never callable from a browser session,
-- same pattern as upsert_daily_activity / update_engagement_status
-- (018_c1_rpc_privilege_escalation_fix.sql). This is the actual trust
-- boundary: the Next.js API route (using the service-role client) is
-- what's allowed to decide a quest is complete and award XP to people who
-- aren't the caller.
REVOKE ALL ON FUNCTION public.service_complete_group_quest(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.service_complete_group_quest(UUID) FROM authenticated;
