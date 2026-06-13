-- ============================================================
-- Migration: 013_analytics_retention.sql
-- Analytics tables for retention, engagement, and churn tracking.
-- Does NOT modify any existing tables.
-- ============================================================

-- ── 1. analytics_daily_activity ──────────────────────────────
-- One row per user per calendar day.
-- Used for D1 / D7 / D30 retention, WAU, MAU calculations.
-- Written to by application logic (API routes).

CREATE TABLE IF NOT EXISTS public.analytics_daily_activity (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid         NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date             date         NOT NULL,

  -- Activity signals
  app_opened       boolean      NOT NULL DEFAULT false,
  deposit_count    integer      NOT NULL DEFAULT 0,
  xp_gained        integer      NOT NULL DEFAULT 0,
  quests_completed integer      NOT NULL DEFAULT 0,

  -- Metadata
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT analytics_daily_activity_user_date_unique UNIQUE (user_id, date)
);

-- Efficient lookups by user (retention queries) and by date (DAU queries)
CREATE INDEX IF NOT EXISTS analytics_daily_activity_user_id_idx
  ON public.analytics_daily_activity (user_id);

CREATE INDEX IF NOT EXISTS analytics_daily_activity_date_idx
  ON public.analytics_daily_activity (date DESC);

-- RLS: users can only read their own rows; server writes via service role
ALTER TABLE public.analytics_daily_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own activity"
  ON public.analytics_daily_activity
  FOR SELECT
  USING (auth.uid() = user_id);

-- Service role (server) has full access — no policy needed for service role.

-- ── 2. user_engagement_status ────────────────────────────────
-- Tracks churn signal for each user.
-- Automatically maintained by the update_engagement_status() function below.

CREATE TABLE IF NOT EXISTS public.user_engagement_status (
  user_id            uuid         PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  status             text         NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active', 'at_risk', 'churned')),
  last_active_date   date,
  days_since_active  integer      NOT NULL DEFAULT 0,
  updated_at         timestamptz  NOT NULL DEFAULT now()
);

-- Index for admin dashboard queries (count by status)
CREATE INDEX IF NOT EXISTS user_engagement_status_status_idx
  ON public.user_engagement_status (status);

-- RLS: users cannot read other users' status
ALTER TABLE public.user_engagement_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own engagement status"
  ON public.user_engagement_status
  FOR SELECT
  USING (auth.uid() = user_id);

-- ── 3. Helper function: upsert_daily_activity ─────────────────
-- Called from API routes to record a day's activity atomically.
-- Uses INSERT ... ON CONFLICT to avoid races.
--
-- Parameters:
--   p_user_id          uuid
--   p_date             date
--   p_app_opened       boolean (default false)
--   p_deposit_delta    integer (add to deposit_count, default 0)
--   p_xp_delta         integer (add to xp_gained, default 0)
--   p_quest_delta      integer (add to quests_completed, default 0)

CREATE OR REPLACE FUNCTION public.upsert_daily_activity(
  p_user_id       uuid,
  p_date          date,
  p_app_opened    boolean DEFAULT false,
  p_deposit_delta integer DEFAULT 0,
  p_xp_delta      integer DEFAULT 0,
  p_quest_delta   integer DEFAULT 0
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.analytics_daily_activity
    (user_id, date, app_opened, deposit_count, xp_gained, quests_completed, updated_at)
  VALUES
    (p_user_id, p_date, p_app_opened, p_deposit_delta, p_xp_delta, p_quest_delta, now())
  ON CONFLICT (user_id, date) DO UPDATE SET
    app_opened       = analytics_daily_activity.app_opened OR p_app_opened,
    deposit_count    = analytics_daily_activity.deposit_count    + p_deposit_delta,
    xp_gained        = analytics_daily_activity.xp_gained        + p_xp_delta,
    quests_completed = analytics_daily_activity.quests_completed + p_quest_delta,
    updated_at       = now();
END;
$$;

-- ── 4. Helper function: update_engagement_status ─────────────
-- Recalculates churn status for all users (or a single user).
-- Run as a scheduled job (e.g. pg_cron every hour) or call after login.
--
-- Rules:
--   0–3 days inactive  → active
--   4–7 days inactive  → at_risk
--   8+  days inactive  → churned
--
-- "Last active" is derived from profiles.last_active_date (existing column).

CREATE OR REPLACE FUNCTION public.update_engagement_status(
  p_user_id uuid DEFAULT NULL   -- NULL = update all users
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := current_date;
BEGIN
  INSERT INTO public.user_engagement_status
    (user_id, status, last_active_date, days_since_active, updated_at)
  SELECT
    p.id,
    CASE
      WHEN p.last_active_date IS NULL         THEN 'active'   -- brand new user
      WHEN v_today - p.last_active_date <= 3  THEN 'active'
      WHEN v_today - p.last_active_date <= 7  THEN 'at_risk'
      ELSE                                         'churned'
    END,
    p.last_active_date,
    COALESCE(v_today - p.last_active_date, 0),
    now()
  FROM public.profiles p
  WHERE (p_user_id IS NULL OR p.id = p_user_id)
  ON CONFLICT (user_id) DO UPDATE SET
    status            = EXCLUDED.status,
    last_active_date  = EXCLUDED.last_active_date,
    days_since_active = EXCLUDED.days_since_active,
    updated_at        = now();
END;
$$;

-- ── 5. Trigger: keep engagement status fresh on profile update ─
-- Fires whenever profiles.last_active_date changes so the status
-- stays current without a separate cron job.

CREATE OR REPLACE FUNCTION public.trg_refresh_engagement_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only re-calculate when last_active_date actually changed
  IF NEW.last_active_date IS DISTINCT FROM OLD.last_active_date THEN
    PERFORM public.update_engagement_status(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refresh_engagement_status_on_profile_update
  ON public.profiles;

CREATE TRIGGER refresh_engagement_status_on_profile_update
  AFTER UPDATE OF last_active_date ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_refresh_engagement_status();

-- ── 6. Back-fill existing users ──────────────────────────────
-- On first deploy, seed engagement status for all current users.
SELECT public.update_engagement_status(NULL);
