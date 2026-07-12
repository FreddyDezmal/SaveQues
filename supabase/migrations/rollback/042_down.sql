-- 040_down.sql
-- Rollback for 040_award_xp_allowlist.sql
-- Restores award_xp() to its exact pre-migration form (018's version:
-- p_xp >= 0 only, no source_type allowlist, no upper cap).
--
-- CAUTION: rolling this back reopens the direct-RPC XP-farming hole
-- described in 040's header comment. Only do this if 040 itself is found
-- to be blocking a legitimate source_type that was missed — fix the
-- allowlist forward with a new migration instead of rolling back, if at
-- all possible.

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
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_source_type = 'admin_grant' THEN
    RAISE EXCEPTION 'admin_grant source_type is not permitted via direct RPC'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_xp < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'xp must be non-negative');
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
