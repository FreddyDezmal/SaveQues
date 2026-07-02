-- ─────────────────────────────────────────────────────────────────────────────
-- 037_purchase_shield_rpc.sql
-- Atomic XP deduction + shield grant for the shield purchase feature.
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY A DB FUNCTION?
--   The profiles UPDATE RLS policy (migration 010) blocks client-side updates
--   to xp_total and streak_shields — correctly preventing users from inflating
--   their own stats. The purchase-shield route uses createClient() (user
--   session), so the UPDATE was being blocked by RLS and returning 0 rows,
--   which the route treated as a race condition (409).
--
--   A SECURITY DEFINER function runs as the function owner (postgres role),
--   bypassing RLS. The C1 ownership guard (auth.uid() = p_user_id) ensures
--   a user can only purchase for themselves, preserving security.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.purchase_shield(
  p_user_id   UUID,
  p_xp_cost   INTEGER DEFAULT 10000,
  p_max_shields INTEGER DEFAULT 5
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_xp_total      INTEGER;
  v_shields       INTEGER;
  v_new_xp        INTEGER;
  v_new_shields   INTEGER;
BEGIN
  -- ── C1: Ownership guard ───────────────────────────────────────────────────
  IF auth.uid() <> p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  -- ── Read current state ────────────────────────────────────────────────────
  SELECT xp_total, streak_shields
  INTO v_xp_total, v_shields
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE; -- lock row to prevent concurrent purchases

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile_not_found');
  END IF;

  -- ── Validate ──────────────────────────────────────────────────────────────
  IF v_xp_total < p_xp_cost THEN
    RETURN jsonb_build_object(
      'success',   false,
      'error',     'insufficient_xp',
      'required',  p_xp_cost,
      'current',   v_xp_total,
      'shortfall', p_xp_cost - v_xp_total
    );
  END IF;

  IF v_shields >= p_max_shields THEN
    RETURN jsonb_build_object(
      'success',    false,
      'error',      'shield_limit_reached',
      'maxShields', p_max_shields,
      'current',    v_shields
    );
  END IF;

  -- ── Atomic update ─────────────────────────────────────────────────────────
  v_new_xp      := v_xp_total - p_xp_cost;
  v_new_shields := v_shields + 1;

  UPDATE public.profiles
  SET
    xp_total       = v_new_xp,
    streak_shields = v_new_shields
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'success',      true,
    'xp_spent',     p_xp_cost,
    'xp_remaining', v_new_xp,
    'shields_after', v_new_shields
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purchase_shield(UUID, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purchase_shield(UUID, INTEGER, INTEGER) TO authenticated;