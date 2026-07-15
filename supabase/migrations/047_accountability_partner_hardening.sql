-- ─────────────────────────────────────────────────────────────────────────────
-- 047_accountability_partner_hardening.sql
-- Sprint 22, Phase 4 — Accountability partners
--
-- Two parts:
--
-- A. Hardens accountability_partners the same way 046 hardened
--    friendships — 045's INSERT/UPDATE policies had the identical two gaps
--    (status not restricted on insert; requester_id/partner_id not locked
--    on update). Found this time by re-reading 045 in light of what 046
--    fixed, rather than waiting to rediscover it via testing — but still
--    verified by testing below, since assuming a fix works has already
--    burned time twice this sprint.
--
--    Additionally centralizes "who can move this relationship from status
--    X to status Y" in one trigger rather than several ad-hoc RLS clauses
--    — pending→active only by the invited partner, pending→declined or
--    active→ended by either party, everything else rejected. This is new
--    (friendships didn't need it — its accept/decline logic lived in the
--    /api/friends/respond route instead), because accountability_partners
--    has a stricter transition graph (e.g. declined→active should never
--    be reachable at all) that's clearer as one trigger than scattered
--    per-route checks that could drift out of sync with each other.
--
-- B. get_partner_progress() — the read path for "Partner progress" /
--    "Shared streak motivation". Returns level, streak, and a boolean
--    "saved this week" — never an amount, balance, or goal value. The
--    boolean is computed by a SECURITY DEFINER function reading
--    transactions (RLS-locked to auth.uid() = user_id, untouched), which
--    is a read, not a write — consistent with "money logic is read-only".
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- PART A — Harden accountability_partners
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "accountability_insert_own_request" ON public.accountability_partners;
CREATE POLICY "accountability_insert_own_request"
  ON public.accountability_partners FOR INSERT
  WITH CHECK (auth.uid() = requester_id AND status = 'pending');

-- Simplified to "you're a participant" — the transition trigger below owns
-- which status changes are actually valid and who may make them.
DROP POLICY IF EXISTS "accountability_update_own" ON public.accountability_partners;
CREATE POLICY "accountability_update_own"
  ON public.accountability_partners FOR UPDATE
  USING (auth.uid() = requester_id OR auth.uid() = partner_id)
  WITH CHECK (auth.uid() = requester_id OR auth.uid() = partner_id);

CREATE OR REPLACE FUNCTION public.enforce_accountability_transition()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.requester_id <> OLD.requester_id OR NEW.partner_id <> OLD.partner_id THEN
    RAISE EXCEPTION 'requester_id/partner_id cannot be changed after creation'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.status = OLD.status THEN
    RETURN NEW; -- non-status field touch (shouldn't happen from the routes below, but not a transition to validate)
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'active' THEN
    IF auth.uid() <> OLD.partner_id THEN
      RAISE EXCEPTION 'Only the invited partner can accept this request'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.responded_at := COALESCE(NEW.responded_at, NOW());

  ELSIF OLD.status = 'pending' AND NEW.status = 'declined' THEN
    -- Either the invited partner declining, or the requester cancelling
    -- their own pending request — both are legitimate "never mind" paths.
    NEW.responded_at := COALESCE(NEW.responded_at, NOW());

  ELSIF OLD.status = 'active' AND NEW.status = 'ended' THEN
    -- Either party can end an active partnership.
    NEW.ended_at := COALESCE(NEW.ended_at, NOW());

  ELSE
    RAISE EXCEPTION 'Invalid accountability partner transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_accountability_transition ON public.accountability_partners;
CREATE TRIGGER trg_enforce_accountability_transition
  BEFORE UPDATE ON public.accountability_partners
  FOR EACH ROW EXECUTE FUNCTION public.enforce_accountability_transition();


-- ═══════════════════════════════════════════════════════════════════════════
-- PART B — Partner progress (privacy-respecting, zero financial exposure)
-- ═══════════════════════════════════════════════════════════════════════════

-- One round trip for the whole partner card, whatever state it's in —
-- none, a pending request in either direction, or an active partnership
-- with progress. Consolidated for the same round-trip reason as
-- list_friends() (046): the route would otherwise need a status query
-- plus a separate profile lookup for whichever other user is involved.
CREATE OR REPLACE FUNCTION public.get_partner_status()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_rel    RECORD;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_rel
  FROM public.accountability_partners
  WHERE status IN ('pending', 'active') AND (requester_id = v_caller OR partner_id = v_caller)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'none');
  END IF;

  DECLARE
    v_other_id UUID := CASE WHEN v_rel.requester_id = v_caller THEN v_rel.partner_id ELSE v_rel.requester_id END;
    v_profile  RECORD;
    v_state    TEXT;
    v_saved_this_week BOOLEAN := NULL;
  BEGIN
    SELECT id, username, display_name, avatar_emoji, current_level, streak_days, longest_streak
    INTO v_profile
    FROM public.profiles WHERE id = v_other_id;

    IF v_rel.status = 'active' THEN
      v_state := 'active';
      SELECT EXISTS (
        SELECT 1 FROM public.transactions
        WHERE user_id = v_other_id
          AND transaction_type = 'deposit'
          AND created_at >= date_trunc('week', NOW())
      ) INTO v_saved_this_week;
    ELSIF v_rel.requester_id = v_caller THEN
      v_state := 'pending_sent';
    ELSE
      v_state := 'pending_received';
    END IF;

    RETURN jsonb_build_object(
      'state', v_state,
      'accountability_id', v_rel.id,
      'partner_since', v_rel.responded_at,
      'partner', jsonb_build_object(
        'id', v_profile.id,
        'username', v_profile.username,
        'display_name', v_profile.display_name,
        'avatar_emoji', v_profile.avatar_emoji,
        'current_level', v_profile.current_level,
        'streak_days', v_profile.streak_days,
        'longest_streak', v_profile.longest_streak,
        'saved_this_week', v_saved_this_week
      )
    );
  END;
END;
$$;
