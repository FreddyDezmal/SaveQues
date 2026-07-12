-- 042_award_xp_allowlist.sql
--
-- Admin CRUD audit finding (docs/ADMIN_CRUD_AUDIT.md, "Critical: award_xp
-- is directly callable and does not validate its inputs"): award_xp() is
-- GRANTed to `authenticated` (migration 018), and is called via the same
-- anon-key + user-session Supabase client from both trusted server code
-- (lib/awardXP.ts) and — with nothing to stop it — directly from any
-- authenticated browser session. The only existing guards are p_xp >= 0
-- and a denylist of exactly one source_type ('admin_grant'). Any other
-- source_type + a source_id that's never been used before succeeds with
-- whatever p_xp the caller supplies, repeatable indefinitely by inventing
-- new source_id values.
--
-- THIS MIGRATION IS A PARTIAL, DEFENSE-IN-DEPTH MITIGATION, NOT A COMPLETE
-- FIX. It closes the trivial "invent an arbitrary new source_type and farm
-- forever" version of the hole (allowlist) and bounds worst-case damage
-- per individual call (hard cap, set above the largest real single award
-- in the codebase — 20,000 XP, the "Ultimate Saver" achievement — with
-- headroom). It does NOT verify that a given source_id genuinely
-- corresponds to a real event, because award_xp has no way to know that;
-- only the specific complete_* RPCs (which compute p_xp server-side from
-- real data before calling award_xp internally) can. A determined,
-- authenticated attacker could still call e.g.
-- award_xp(self, 'achievement', 'not-a-real-id', 25000) once per invented
-- source_id. The complete fix is to move XP-awarding calls behind a
-- service-role trust boundary the browser can never reach, which is a
-- larger, separate initiative — see docs/ADMIN_CRUD_AUDIT.md, Priority 0.

CREATE OR REPLACE FUNCTION public.award_xp(
  p_user_id     UUID,
  p_source_type TEXT,
  p_source_id   TEXT,
  p_xp          INTEGER,
  p_date        DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new_total INTEGER;
  v_current   INTEGER;
BEGIN
  -- ── C1 guard: caller must own the account ─────────────────
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── C1 guard: block admin_grant via direct RPC ────────────
  -- Admin XP grants must flow through the service_role client
  -- (server-side API routes), never via direct browser RPC.
  IF p_source_type = 'admin_grant' THEN
    RAISE EXCEPTION 'admin_grant source_type is not permitted via direct RPC'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── Audit fix: allowlist of source_types real code actually uses ──
  -- (mirrors lib/awardXP.ts's XPSourceType union, minus admin_grant which
  -- is blocked above, plus 'daily_checkin' which is only ever called
  -- internally from complete_daily_checkin(), not from lib/awardXP.ts).
  IF p_source_type NOT IN (
    'daily_quest', 'weekly_quest', 'challenge', 'chain_step', 'chain_complete',
    'log_saving', 'goal_complete', 'event_complete', 'achievement', 'daily_checkin'
  ) THEN
    RAISE EXCEPTION 'unrecognized source_type: %', p_source_type
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── Audit fix: hard sanity cap ─────────────────────────────
  -- Set comfortably above the largest legitimate single award in the
  -- codebase (20,000 XP) so no real flow is affected; bounds worst-case
  -- damage from a single direct-RPC call rather than leaving it unbounded.
  IF p_xp < 0 OR p_xp > 25000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'xp must be between 0 and 25000');
  END IF;

  INSERT INTO public.xp_awards (user_id, source_type, source_id, xp_awarded)
  VALUES (p_user_id, p_source_type, p_source_id, p_xp)
  ON CONFLICT (user_id, source_type, source_id) DO NOTHING;

  IF NOT FOUND THEN
    SELECT xp_total INTO v_current FROM public.profiles WHERE id = p_user_id;
    RETURN jsonb_build_object('success', true, 'xp_awarded', 0,
      'new_total', COALESCE(v_current, 0), 'reason', 'already_awarded');
  END IF;

  UPDATE public.profiles SET xp_total = xp_total + p_xp
  WHERE id = p_user_id RETURNING xp_total INTO v_new_total;

  IF NOT FOUND THEN
    DELETE FROM public.xp_awards
    WHERE user_id = p_user_id AND source_type = p_source_type AND source_id = p_source_id;
    RETURN jsonb_build_object('success', false, 'error', 'profile not found');
  END IF;

  PERFORM public.log_activity_event(p_user_id, p_date, p_xp, 1);

  RETURN jsonb_build_object('success', true, 'xp_awarded', p_xp, 'new_total', v_new_total);
END;
$$;

REVOKE ALL ON FUNCTION public.award_xp(UUID, TEXT, TEXT, INTEGER, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_xp(UUID, TEXT, TEXT, INTEGER, DATE) TO authenticated;
