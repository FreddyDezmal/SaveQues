-- ============================================================
-- 061_admin_award_xp.sql
-- Sprint 24 — Phase 8: Internal Developer Console — award-xp action.
-- ============================================================
-- WHY THIS FUNCTION EXISTS INSTEAD OF REUSING award_xp()
--   Read supabase/migrations/018_c1_rpc_privilege_escalation_fix.sql
--   before touching this file. That migration fixed a real
--   vulnerability where any authenticated user could call award_xp()
--   directly with source_type = 'admin_grant' and self-award XP as if
--   an admin had granted it. The fix was to reject 'admin_grant'
--   UNCONDITIONALLY inside award_xp() — not "unless the caller is an
--   admin," just outright, for every caller, including service_role.
--   That migration's own stated strategy for functions "not called
--   directly by the browser client" is: "REVOKE EXECUTE from
--   `authenticated` entirely; these functions are invoked only from
--   server-side Next.js API routes using the service_role client." A
--   genuine admin-grant path was never actually built to that spec —
--   award_xp() just permanently closed the door instead. This function
--   is that missing path, built to the exact strategy 018 already
--   documented, as its own separate function so award_xp()'s guard is
--   never loosened or special-cased. Zero risk to the existing fix.
--
-- Mirrors award_xp()'s real body (same xp_awards idempotency table,
-- same ON CONFLICT DO NOTHING, same profiles.xp_total update, same
-- log_activity_event call so momentum/streak-adjacent activity data
-- stays consistent with every other XP award) — deliberately NOT a
-- generic "run arbitrary SQL as admin" tool, just this one well-scoped
-- operation with the same shape as the real thing.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_award_xp(
  p_user_id     UUID,
  p_source_id   TEXT,
  p_xp          INTEGER,
  p_date        DATE DEFAULT CURRENT_DATE
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current    INTEGER;
  v_new_total  INTEGER;
BEGIN
  IF p_xp <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'xp must be positive');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile not found');
  END IF;

  INSERT INTO public.xp_awards (user_id, source_type, source_id, xp_awarded)
  VALUES (p_user_id, 'admin_grant', p_source_id, p_xp)
  ON CONFLICT (user_id, source_type, source_id) DO NOTHING;

  IF NOT FOUND THEN
    SELECT xp_total INTO v_current FROM public.profiles WHERE id = p_user_id;
    RETURN jsonb_build_object('success', true, 'xp_awarded', 0,
      'new_total', COALESCE(v_current, 0), 'reason', 'already_awarded');
  END IF;

  UPDATE public.profiles SET xp_total = xp_total + p_xp
  WHERE id = p_user_id RETURNING xp_total INTO v_new_total;

  PERFORM public.log_activity_event(p_user_id, p_date, p_xp, 1);

  RETURN jsonb_build_object('success', true, 'xp_awarded', p_xp, 'new_total', v_new_total);
END;
$$;

-- The whole point: unreachable from a browser session, even a
-- compromised/malicious one, regardless of admin status. Only code
-- holding the service_role key (app/api/admin/dev-console/award-xp)
-- can ever call this.
REVOKE ALL ON FUNCTION public.admin_award_xp(UUID, TEXT, INTEGER, DATE) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.admin_award_xp(UUID, TEXT, INTEGER, DATE) TO service_role;

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================
-- SELECT has_function_privilege('authenticated', 'public.admin_award_xp(uuid,text,integer,date)', 'EXECUTE');
-- Expected: false.
-- SELECT has_function_privilege('service_role', 'public.admin_award_xp(uuid,text,integer,date)', 'EXECUTE');
-- Expected: true.
-- ============================================================
