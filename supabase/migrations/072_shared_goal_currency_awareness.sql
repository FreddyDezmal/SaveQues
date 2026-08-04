-- 072_shared_goal_currency_awareness.sql
--
-- Sprint 31 — Phase 9: Social Feature Compatibility.
--
-- AUDIT FINDING (see Phase 9 design note): group_contributions.amount had
-- no currency_code of its own, and get_shared_goal_detail() (049) did a
-- plain SUM(gc.amount) across ALL contributors regardless of currency —
-- so a ZAR contributor's 500 and a USD contributor's 500 were silently
-- summed as if they were the same money.
--
-- FIX, two parts:
--   1. currency_code added to group_contributions, captured at insert
--      time from the contributor's own profile (app layer — see
--      app/api/shared-goals/contribute/route.ts). DEFAULT 'ZAR' is not a
--      guess for existing rows: this has been a single-currency ZAR
--      platform up to this sprint, so every existing contribution really
--      was ZAR.
--   2. get_shared_goal_detail() no longer does a cross-currency SUM at
--      all — SQL only ever sums amounts that share a currency_code
--      (safe), returning a per-currency breakdown instead of one
--      collapsed total. The actual cross-currency normalization (via
--      lib/currencyConversion.ts, Phase 7) happens in
--      app/api/shared-goals/detail/route.ts, in Node, where the
--      exchange-rate cache actually lives — never in SQL, and never in
--      the client component. Also adds the owner's currency_code/locale
--      to the response, closing the separate "formatCurrency() called
--      with no currency code, defaulted to ZAR display" bug in
--      SharedGoalDetailClient.tsx.

ALTER TABLE public.group_contributions
  ADD COLUMN IF NOT EXISTS currency_code text NOT NULL DEFAULT 'ZAR'
    CHECK (currency_code IN (
      'ZAR', 'NGN', 'GHS', 'KES', 'EGP', 'MAD', 'DZD', 'TND',
      'ETB', 'UGX', 'TZS', 'RWF', 'ZMW', 'BWP', 'MUR', 'XOF',
      'XAF', 'MZN', 'AOA', 'NAD', 'SZL', 'LSL', 'MWK', 'SDG',
      'LYD', 'CDF', 'SOS', 'AED', 'SAR', 'QAR', 'KWD', 'BHD',
      'OMR', 'ILS', 'JOD', 'LBP', 'IQD', 'TRY', 'INR', 'PKR',
      'BDT', 'LKR', 'NPR', 'CNY', 'JPY', 'KRW', 'HKD', 'TWD',
      'SGD', 'MYR', 'THB', 'IDR', 'PHP', 'VND', 'MMK', 'KHR',
      'LAK', 'MNT', 'BND', 'KZT', 'UZS', 'AZN', 'GEL', 'AMD',
      'EUR', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK',
      'HUF', 'RON', 'BGN', 'UAH', 'RSD', 'ISK', 'ALL', 'MKD',
      'BAM', 'MDL', 'BYN', 'AUD', 'NZD', 'FJD', 'PGK', 'WST',
      'TOP', 'SBD', 'VUV', 'USD', 'CAD', 'MXN', 'BRL', 'ARS',
      'CLP', 'COP', 'PEN', 'UYU', 'PYG', 'BOB', 'GTQ', 'HNL',
      'NIO', 'CRC', 'PAB', 'DOP', 'JMD', 'TTD', 'BBD', 'BSD',
      'BZD', 'GYD', 'SRD', 'HTG'
    ));

-- Replaces the 049 version. Same signature, same auth/visibility checks
-- (can_view_shared_goal) — only the members[].total_contributed and
-- total_group_contributions shapes change (see file header), plus the
-- owner's currency_code/locale are now included.
CREATE OR REPLACE FUNCTION public.get_shared_goal_detail(p_shared_goal_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_sg     RECORD;
  v_goal   RECORD;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT public.can_view_shared_goal(p_shared_goal_id, v_caller) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_sg FROM public.shared_goals WHERE id = p_shared_goal_id;
  SELECT * INTO v_goal FROM public.savings_goals WHERE id = v_sg.goal_id;

  RETURN jsonb_build_object(
    'shared_goal_id', v_sg.id,
    'goal_id', v_goal.id,
    'title', v_goal.title,
    'goal_emoji', v_goal.goal_emoji,
    'category', v_goal.category,
    'target_amount', v_goal.target_amount,
    'current_amount', v_goal.current_amount,
    'target_date', v_goal.target_date,
    'is_complete', v_goal.is_complete,
    'goal_status', v_goal.goal_status,
    'created_at', v_sg.created_at,
    'owner', (
      SELECT jsonb_build_object(
        'id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_emoji', p.avatar_emoji,
        'currency_code', p.currency_code, 'locale', p.locale
      )
      FROM public.profiles p WHERE p.id = v_sg.owner_id
    ),
    'group', (
      CASE WHEN v_sg.group_id IS NULL THEN NULL ELSE (
        SELECT jsonb_build_object('id', g.id, 'name', g.name, 'emoji', g.emoji)
        FROM public.groups g WHERE g.id = v_sg.group_id
      ) END
    ),
    'members', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'member_id', sgm.id,
        'user_id', p.id,
        'username', p.username,
        'display_name', p.display_name,
        'avatar_emoji', p.avatar_emoji,
        'status', sgm.status,
        -- Per-currency breakdown, NOT a single cross-currency total — see
        -- file header. Each element only ever sums amounts that share a
        -- currency_code, which is always a safe SQL SUM. Converting and
        -- combining these into one number happens in Node
        -- (app/api/shared-goals/detail/route.ts), not here.
        'contributions_by_currency', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('currency_code', gc.currency_code, 'amount', gc.total))
          FROM (
            SELECT currency_code, SUM(amount) AS total
            FROM public.group_contributions
            WHERE shared_goal_id = v_sg.id AND user_id = sgm.user_id
            GROUP BY currency_code
          ) gc
        ), '[]'::jsonb)
      ) ORDER BY sgm.created_at ASC), '[]'::jsonb)
      FROM public.shared_goal_members sgm
      JOIN public.profiles p ON p.id = sgm.user_id
      WHERE sgm.shared_goal_id = v_sg.id
    ),
    'total_group_contributions_by_currency', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('currency_code', t.currency_code, 'amount', t.total))
      FROM (
        SELECT currency_code, SUM(amount) AS total
        FROM public.group_contributions
        WHERE shared_goal_id = v_sg.id
        GROUP BY currency_code
      ) t
    ), '[]'::jsonb)
  );
END;
$$;
