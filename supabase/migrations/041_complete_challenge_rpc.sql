-- 041_complete_challenge_rpc.sql
--
-- Admin CRUD audit finding (docs/ADMIN_CRUD_AUDIT.md): migration
-- 019_s3_rls_write_lockdown.sql removed the UPDATE policy on
-- public.user_challenges for the `authenticated` role (comment there says
-- "status transitions go through the server route + complete_weekly_quest()
-- SECURITY DEFINER"), but app/api/quest/challenge/complete/route.ts never
-- actually called a SECURITY DEFINER function for that transition — it did
-- a plain client-side `.update()` on user_challenges. Supabase/PostgREST
-- does not error on an UPDATE that matches zero rows (RLS silently filters
-- them out), so the route proceeded, successfully awarded XP via award_xp()
-- (which *is* SECURITY DEFINER), but user_challenges.status was NEVER
-- actually written to 'completed'. Net effect: users got paid correctly,
-- but every completed seasonal challenge stayed stuck showing as "active"
-- forever, and any code counting `status = 'completed'` (e.g. the
-- challengesCompleted achievement param) silently undercounted.
--
-- This migration adds the missing SECURITY DEFINER function, mirroring the
-- existing complete_daily_quest / complete_weekly_quest / complete_chain_step
-- pattern exactly. The route is updated in the same change to call it.

CREATE OR REPLACE FUNCTION public.complete_challenge(
  p_user_id           UUID,
  p_user_challenge_id UUID,
  p_xp                INTEGER
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result JSONB;
  v_rows   INTEGER;
BEGIN
  -- Identity guard — same pattern as every other complete_* RPC.
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Atomic guard: only a row the caller owns, currently 'active', flips to
  -- 'completed'. A second concurrent/duplicate call matches zero rows.
  UPDATE public.user_challenges
  SET status = 'completed', completed_at = NOW()
  WHERE id = p_user_challenge_id
    AND user_id = p_user_id
    AND status = 'active';
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RETURN jsonb_build_object('success', true, 'xp_awarded', 0, 'reason', 'already_awarded');
  END IF;

  SELECT public.award_xp(p_user_id, 'challenge', p_user_challenge_id::TEXT, p_xp) INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_challenge(UUID, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_challenge(UUID, UUID, INTEGER) TO authenticated;
