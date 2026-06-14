-- ============================================================
-- SaveQuest Migration 009 — XP Awards Table & Core award_xp()
-- ============================================================
-- Establishes the append-only audit log that backs all XP grants
-- and the single SECURITY DEFINER function that is the ONLY
-- permitted path to increment profiles.xp_total.
--
-- Depends on: 001 (profiles, activity_log via 002)
-- Required by: 010, 011, 012
-- ============================================================

-- ── XP AWARDS TABLE ──────────────────────────────────────────
-- One row per XP grant. The UNIQUE constraint on
-- (user_id, source_type, source_id) is the idempotency key:
-- a duplicate insert is silently ignored, so replaying any
-- awarding action is always safe.
--
-- source_id format per source_type:
--   daily_quest    → YYYY-MM-DD            (one award per calendar day)
--   weekly_quest   → week_start date       (one award per week)
--   challenge      → user_challenges.id    (one award per accepted challenge)
--   chain_step     → "chain_id:N"          (one award per step per chain)
--   chain_complete → chain_id              (one award per completed chain)
--   log_saving     → transactions.id       (one award per deposit tx)
--   goal_complete  → savings_goals.id      (one award per completed goal)
--   event_complete → event_slug            (one award per event)
--   achievement    → achievement_id        (one award per badge)
--   admin_grant    → free-form string      (no dedup — multiple grants allowed)
CREATE TABLE IF NOT EXISTS public.xp_awards (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_type  TEXT        NOT NULL
               CHECK (source_type IN (
                 'daily_quest',
                 'weekly_quest',
                 'challenge',
                 'chain_step',
                 'chain_complete',
                 'log_saving',
                 'goal_complete',
                 'event_complete',
                 'achievement',
                 'admin_grant'
               )),
  source_id    TEXT        NOT NULL,
  xp_awarded   INTEGER     NOT NULL CHECK (xp_awarded >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, source_type, source_id)
);

ALTER TABLE public.xp_awards ENABLE ROW LEVEL SECURITY;

-- Users may read their own history (leaderboard, profile audit).
-- All writes go through award_xp() which runs SECURITY DEFINER.
CREATE POLICY "Users can read own xp_awards"
  ON public.xp_awards FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_xp_awards_user_id
  ON public.xp_awards (user_id);

CREATE INDEX IF NOT EXISTS idx_xp_awards_source
  ON public.xp_awards (user_id, source_type, source_id);


-- ── award_xp() — THE ONLY WRITER OF profiles.xp_total ────────
-- Returns JSONB:
--   { "success": true,  "xp_awarded": N, "new_total": N }
--   { "success": true,  "xp_awarded": 0, "new_total": N, "reason": "already_awarded" }
--   { "success": false, "error": "..." }
--
-- Callers must never update profiles.xp_total directly.
-- All action-specific functions in migration 012 delegate here.
CREATE OR REPLACE FUNCTION public.award_xp(
  p_user_id     UUID,
  p_source_type TEXT,
  p_source_id   TEXT,
  p_xp          INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_total INTEGER;
  v_current   INTEGER;
BEGIN
  IF p_xp < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'xp must be non-negative');
  END IF;

  -- Idempotency: insert or skip
  INSERT INTO public.xp_awards (user_id, source_type, source_id, xp_awarded)
  VALUES (p_user_id, p_source_type, p_source_id, p_xp)
  ON CONFLICT (user_id, source_type, source_id) DO NOTHING;

  IF NOT FOUND THEN
    SELECT xp_total INTO v_current
    FROM public.profiles
    WHERE id = p_user_id;

    RETURN jsonb_build_object(
      'success',    true,
      'xp_awarded', 0,
      'new_total',  COALESCE(v_current, 0),
      'reason',     'already_awarded'
    );
  END IF;

  -- Atomically increment xp_total
  UPDATE public.profiles
  SET xp_total = xp_total + p_xp
  WHERE id = p_user_id
  RETURNING xp_total INTO v_new_total;

  IF NOT FOUND THEN
    -- Profile disappeared between insert and update — roll back award row
    DELETE FROM public.xp_awards
    WHERE user_id    = p_user_id
      AND source_type = p_source_type
      AND source_id   = p_source_id;

    RETURN jsonb_build_object('success', false, 'error', 'profile not found');
  END IF;

  -- Keep activity_log in sync (powers the heatmap / streak dashboard)
  INSERT INTO public.activity_log (user_id, activity_date, xp_earned, actions_count)
  VALUES (p_user_id, CURRENT_DATE, p_xp, 1)
  ON CONFLICT (user_id, activity_date)
  DO UPDATE SET
    xp_earned     = activity_log.xp_earned     + p_xp,
    actions_count = activity_log.actions_count + 1;

  RETURN jsonb_build_object(
    'success',    true,
    'xp_awarded', p_xp,
    'new_total',  v_new_total
  );
END;
$$;

-- Authenticated callers (server-side API routes) need EXECUTE.
-- SECURITY DEFINER means the function runs as its owner, not the caller,
-- so the caller gains no extra table-level privileges.
GRANT EXECUTE ON FUNCTION public.award_xp(UUID, TEXT, TEXT, INTEGER)
  TO authenticated;
