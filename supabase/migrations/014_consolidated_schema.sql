-- ============================================================
-- SaveQuest Migration 014b — Consolidated Schema
-- ============================================================
-- This file brings a BLANK Supabase project to the exact same
-- state as production after all legacy migrations + 014_prod_cleanup.
--
-- DO NOT run this on the live database — it is for:
--   • Local dev (supabase db reset)
--   • Staging environments
--   • CI/CD clean-environment tests
--   • Onboarding new developers
--
-- Every statement is idempotent (IF NOT EXISTS / OR REPLACE).
-- Run order matters only for foreign key dependencies, which
-- are respected by the top-to-bottom order below.
-- ============================================================


-- ── EXTENSIONS ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ════════════════════════════════════════════════════════════
-- TABLES
-- ════════════════════════════════════════════════════════════

-- ── profiles ─────────────────────────────────────────────────
-- Extends auth.users. Auto-created by trigger on signup.
CREATE TABLE IF NOT EXISTS public.profiles (
  id                      UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name            TEXT        NOT NULL DEFAULT 'Saver',
  avatar_emoji            TEXT        NOT NULL DEFAULT '🌱',
  xp_total                INTEGER     NOT NULL DEFAULT 0,
  current_level           INTEGER     NOT NULL DEFAULT 1,
  streak_days             INTEGER     NOT NULL DEFAULT 0,
  longest_streak          INTEGER     NOT NULL DEFAULT 0,
  last_active_date        DATE,
  streak_shields          INTEGER     NOT NULL DEFAULT 2,
  total_shields_used      INTEGER     NOT NULL DEFAULT 0,
  streak_paused_until     DATE,
  last_notification_hour  INTEGER,
  daily_quests_completed  INTEGER     NOT NULL DEFAULT 0,
  weekly_quests_completed INTEGER     NOT NULL DEFAULT 0,
  quest_chains_completed  INTEGER     NOT NULL DEFAULT 0,
  goal_emoji              TEXT        NOT NULL DEFAULT '⭐',
  is_admin                BOOLEAN     NOT NULL DEFAULT FALSE,
  currency_code           TEXT        NOT NULL DEFAULT 'ZAR',
  locale                  TEXT        NOT NULL DEFAULT 'en-ZA',
  country_code            TEXT        NOT NULL DEFAULT 'ZA',
  -- Notification system (20260613_notifications)
  timezone                TEXT                 DEFAULT 'UTC',
  notifications_enabled   BOOLEAN              DEFAULT FALSE,
  -- NOTE: notification_enabled (no 's') and reflection_day intentionally
  -- omitted — they existed in 005 but were never used and are dropped by 014.
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Hardened update policy from 010 (replaces permissive 001 version)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'profiles'
      AND policyname = 'Users can update own profile (safe columns only)'
  ) THEN
    CREATE POLICY "Users can update own profile (safe columns only)"
      ON public.profiles FOR UPDATE
      USING (auth.uid() = id)
      WITH CHECK (
        auth.uid() = id
        AND xp_total = (SELECT xp_total FROM public.profiles WHERE id = auth.uid())
        AND streak_days = (SELECT streak_days FROM public.profiles WHERE id = auth.uid())
        AND is_admin = (SELECT is_admin FROM public.profiles WHERE id = auth.uid())
        AND daily_quests_completed = (SELECT daily_quests_completed FROM public.profiles WHERE id = auth.uid())
        AND weekly_quests_completed = (SELECT weekly_quests_completed FROM public.profiles WHERE id = auth.uid())
        AND quest_chains_completed = (SELECT quest_chains_completed FROM public.profiles WHERE id = auth.uid())
      );
  END IF;
END $$;


-- ── savings_goals ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.savings_goals (
  id             UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID         NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title          TEXT         NOT NULL,
  category       TEXT         NOT NULL DEFAULT 'custom',
  goal_emoji     TEXT         NOT NULL DEFAULT '⭐',
  target_amount  NUMERIC(12,2) NOT NULL,
  current_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  target_date    DATE,
  is_complete    BOOLEAN      NOT NULL DEFAULT FALSE,
  -- From 004 / 0062
  is_primary     BOOLEAN      NOT NULL DEFAULT FALSE,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  -- From 0062
  goal_status    TEXT         NOT NULL DEFAULT 'active'
                              CHECK (goal_status IN ('active','paused','completed','archived')),
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE public.savings_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own goals"
  ON public.savings_goals FOR ALL USING (auth.uid() = user_id);

-- Partial unique index: only one active primary goal per user.
-- Predicate matches the 004 version (the one that is actually live in production).
-- 0062 attempted a different predicate (goal_status='active') but was skipped.
CREATE UNIQUE INDEX IF NOT EXISTS one_primary_goal_per_user
  ON public.savings_goals (user_id)
  WHERE is_primary = TRUE AND is_active = TRUE AND is_complete = FALSE;


-- ── transactions ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.transactions (
  id               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID         NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  goal_id          UUID         NOT NULL REFERENCES public.savings_goals(id) ON DELETE CASCADE,
  amount           NUMERIC(12,2) NOT NULL,
  note             TEXT,
  transaction_type TEXT         NOT NULL DEFAULT 'deposit'
                                CHECK (transaction_type IN ('deposit','withdrawal','goal_purchase','adjustment')),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own transactions"
  ON public.transactions FOR ALL USING (auth.uid() = user_id);


-- ── challenges ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.challenges (
  id           UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  title        TEXT    NOT NULL,
  description  TEXT    NOT NULL,
  type         TEXT    NOT NULL DEFAULT 'manual',
  xp_reward    INTEGER NOT NULL DEFAULT 200,
  duration_days INTEGER NOT NULL DEFAULT 7,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  -- From 006: time-bound quest fields
  quest_type   TEXT    NOT NULL DEFAULT 'evergreen'
               CHECK (quest_type IN ('evergreen','seasonal','annual_event','campaign')),
  start_date   DATE,
  end_date     DATE,
  preview_days INTEGER NOT NULL DEFAULT 3,
  year_agnostic BOOLEAN NOT NULL DEFAULT FALSE
);

ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read challenges"
  ON public.challenges FOR SELECT USING (TRUE);

CREATE INDEX IF NOT EXISTS idx_challenges_dates
  ON public.challenges (quest_type, start_date, end_date)
  WHERE is_active = TRUE;


-- ── user_challenges ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_challenges (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  challenge_id UUID        NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  status       TEXT        NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','completed','failed')),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE public.user_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own user_challenges"
  ON public.user_challenges FOR ALL USING (auth.uid() = user_id);


-- ── user_achievements ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_achievements (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  achievement_id TEXT        NOT NULL,
  earned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, achievement_id)
);

ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own achievements"
  ON public.user_achievements FOR ALL USING (auth.uid() = user_id);


-- ── daily_quest_logs ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.daily_quest_logs (
  id         UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  quest_id   TEXT    NOT NULL,
  quest_date DATE    NOT NULL DEFAULT CURRENT_DATE,
  xp_earned  INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, quest_date)
);

ALTER TABLE public.daily_quest_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own daily_quest_logs"
  ON public.daily_quest_logs FOR ALL USING (auth.uid() = user_id);


-- ── quest_chain_progress ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.quest_chain_progress (
  id           UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  chain_id     TEXT    NOT NULL,
  current_step INTEGER NOT NULL DEFAULT 1,
  status       TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (user_id, chain_id)
);

ALTER TABLE public.quest_chain_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own chain_progress"
  ON public.quest_chain_progress FOR ALL USING (auth.uid() = user_id);


-- ── activity_log ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.activity_log (
  id            UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  activity_date DATE    NOT NULL DEFAULT CURRENT_DATE,
  xp_earned     INTEGER NOT NULL DEFAULT 0,
  actions_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, activity_date)
);

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own activity_log"
  ON public.activity_log FOR ALL USING (auth.uid() = user_id);


-- ── weekly_reflections ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.weekly_reflections (
  id               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID         NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  week_start       DATE         NOT NULL,
  savings_count    INTEGER      NOT NULL DEFAULT 0,
  quests_completed INTEGER      NOT NULL DEFAULT 0,
  streak_days      INTEGER      NOT NULL DEFAULT 0,
  xp_earned        INTEGER      NOT NULL DEFAULT 0,
  primary_goal_pct NUMERIC(5,2),
  generated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  viewed_at        TIMESTAMPTZ,
  UNIQUE (user_id, week_start)
);

ALTER TABLE public.weekly_reflections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own reflections"
  ON public.weekly_reflections FOR ALL USING (auth.uid() = user_id);


-- ── user_weekly_quests ────────────────────────────────────────
-- Final schema from 0062 (supersedes 0061 — adds WITH CHECK to policy)
CREATE TABLE IF NOT EXISTS public.user_weekly_quests (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  quest_id     TEXT        NOT NULL,
  week_start   DATE        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','completed','expired')),
  accepted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  xp_earned    INTEGER,
  UNIQUE (user_id, week_start)
);

ALTER TABLE public.user_weekly_quests ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_weekly_quests'
      AND policyname = 'Users can CRUD own weekly quests'
  ) THEN
    CREATE POLICY "Users can CRUD own weekly quests"
      ON public.user_weekly_quests FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;


-- ── events ────────────────────────────────────────────────────
-- 0071 and 007 are identical; we use the canonical schema here once.
CREATE TABLE IF NOT EXISTS public.events (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug            TEXT        NOT NULL UNIQUE,
  title           TEXT        NOT NULL,
  description     TEXT        NOT NULL,
  emoji           TEXT        NOT NULL DEFAULT '⚡',
  event_type      TEXT        NOT NULL DEFAULT 'seasonal'
                  CHECK (event_type IN ('seasonal','calendar','savequest','evergreen')),
  xp_reward       INTEGER     NOT NULL DEFAULT 200,
  available_from  DATE,
  available_until DATE,
  is_annual       BOOLEAN     NOT NULL DEFAULT FALSE,
  preview_days    INTEGER     NOT NULL DEFAULT 5,
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active events"
  ON public.events FOR SELECT USING (is_active = TRUE);

CREATE POLICY "Admins can manage events"
  ON public.events FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE));

CREATE INDEX IF NOT EXISTS idx_events_dates
  ON public.events (available_from, available_until)
  WHERE is_active = TRUE;


-- ── event_regions ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.event_regions (
  id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  region   TEXT NOT NULL CHECK (region IN ('GLOBAL','ZA','US','GB','AU','CA','NG','KE','IN'))
);

ALTER TABLE public.event_regions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read event regions"
  ON public.event_regions FOR SELECT USING (TRUE);

CREATE POLICY "Admins can manage event_regions"
  ON public.event_regions FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE));

CREATE INDEX IF NOT EXISTS idx_event_regions_event_id ON public.event_regions(event_id);
CREATE INDEX IF NOT EXISTS idx_event_regions_region   ON public.event_regions(region);


-- ── user_event_participation ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_event_participation (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_slug   TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','completed','expired')),
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  xp_earned    INTEGER,
  UNIQUE (user_id, event_slug)
);

ALTER TABLE public.user_event_participation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own event participation"
  ON public.user_event_participation FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_uep_user_id    ON public.user_event_participation(user_id);
CREATE INDEX IF NOT EXISTS idx_uep_event_slug ON public.user_event_participation(event_slug);


-- ── xp_awards ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.xp_awards (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_type TEXT        NOT NULL
              CHECK (source_type IN (
                'daily_quest','weekly_quest','challenge','chain_step',
                'chain_complete','log_saving','goal_complete',
                'event_complete','achievement','admin_grant'
              )),
  source_id   TEXT        NOT NULL,
  xp_awarded  INTEGER     NOT NULL CHECK (xp_awarded >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, source_type, source_id)
);

ALTER TABLE public.xp_awards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own xp_awards"
  ON public.xp_awards FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_xp_awards_user_id ON public.xp_awards(user_id);
CREATE INDEX IF NOT EXISTS idx_xp_awards_source  ON public.xp_awards(user_id, source_type, source_id);


-- ── analytics_daily_activity ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.analytics_daily_activity (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date             DATE        NOT NULL,
  app_opened       BOOLEAN     NOT NULL DEFAULT FALSE,
  deposit_count    INTEGER     NOT NULL DEFAULT 0,
  xp_gained        INTEGER     NOT NULL DEFAULT 0,
  quests_completed INTEGER     NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT analytics_daily_activity_user_date_unique UNIQUE (user_id, date)
);

ALTER TABLE public.analytics_daily_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own activity"
  ON public.analytics_daily_activity FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS analytics_daily_activity_user_id_idx ON public.analytics_daily_activity(user_id);
CREATE INDEX IF NOT EXISTS analytics_daily_activity_date_idx    ON public.analytics_daily_activity(date DESC);


-- ── user_engagement_status ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_engagement_status (
  user_id           UUID        PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  status            TEXT        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active','at_risk','churned')),
  last_active_date  DATE,
  days_since_active INTEGER     NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_engagement_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own engagement status"
  ON public.user_engagement_status FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS user_engagement_status_status_idx ON public.user_engagement_status(status);


-- ── push_subscriptions ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint   TEXT        NOT NULL,
  p256dh     TEXT        NOT NULL,
  auth       TEXT        NOT NULL,
  user_agent TEXT,
  timezone   TEXT        NOT NULL DEFAULT 'UTC',
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, endpoint)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "push_subscriptions_own"
  ON public.push_subscriptions FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx ON public.push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS push_subscriptions_active_idx  ON public.push_subscriptions(is_active) WHERE is_active = TRUE;


-- ── notification_logs ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_logs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  subscription_id   UUID        REFERENCES public.push_subscriptions(id) ON DELETE SET NULL,
  notification_type TEXT        NOT NULL,
  title             TEXT        NOT NULL,
  body              TEXT        NOT NULL,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at      TIMESTAMPTZ,
  clicked_at        TIMESTAMPTZ,
  error             TEXT
);

ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notification_logs_read_own"
  ON public.notification_logs FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS notification_logs_user_id_idx ON public.notification_logs(user_id);
CREATE INDEX IF NOT EXISTS notification_logs_sent_at_idx ON public.notification_logs(sent_at);
CREATE INDEX IF NOT EXISTS notification_logs_type_idx    ON public.notification_logs(notification_type);


-- ── completed_goals_summary (VIEW) ───────────────────────────
-- Created by 0072_Yikes.sql. Depends on savings_goals.goal_status,
-- is_active, is_complete, completed_at, and transactions.transaction_type.
CREATE OR REPLACE VIEW public.completed_goals_summary
WITH (security_invoker = TRUE)
AS
SELECT
  g.id,
  g.user_id,
  g.title,
  g.category,
  g.goal_emoji,
  g.target_amount,
  g.current_amount,
  g.completed_at,
  g.created_at,
  EXTRACT(DAY FROM (g.completed_at - g.created_at))::INTEGER AS days_to_complete,
  (
    SELECT COALESCE(SUM(t.amount), 0)
    FROM public.transactions t
    WHERE t.goal_id = g.id AND t.transaction_type = 'deposit'
  ) AS total_deposited,
  (
    SELECT COUNT(*)
    FROM public.transactions t
    WHERE t.goal_id = g.id AND t.transaction_type = 'deposit'
  ) AS deposit_count
FROM public.savings_goals g
WHERE g.is_complete = TRUE
  AND g.is_active   = TRUE;


-- ════════════════════════════════════════════════════════════
-- FUNCTIONS & TRIGGERS
-- ════════════════════════════════════════════════════════════

-- ── handle_new_user — auto-create profile on signup ──────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', 'Saver'));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ── update_goal_amount — v2 from 0062 (handles all tx types) ─
CREATE OR REPLACE FUNCTION public.update_goal_amount()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE delta NUMERIC;
BEGIN
  IF NEW.transaction_type = 'deposit' THEN
    delta := NEW.amount;
  ELSE
    delta := -NEW.amount;
  END IF;

  UPDATE public.savings_goals
  SET current_amount = GREATEST(0, current_amount + delta)
  WHERE id = NEW.goal_id;

  IF NEW.transaction_type = 'goal_purchase' THEN
    UPDATE public.savings_goals
    SET goal_status = 'completed', is_complete = TRUE, completed_at = NOW()
    WHERE id = NEW.goal_id AND current_amount >= target_amount;
  END IF;

  IF NEW.transaction_type = 'deposit' THEN
    UPDATE public.savings_goals
    SET is_complete = TRUE
    WHERE id = NEW.goal_id AND current_amount >= target_amount AND is_complete = FALSE;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_transaction_insert ON public.transactions;
CREATE TRIGGER on_transaction_insert
  AFTER INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_goal_amount();


-- ── enforce_transaction_goal_ownership ───────────────────────
CREATE OR REPLACE FUNCTION public.enforce_transaction_goal_ownership()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.savings_goals
    WHERE id = NEW.goal_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Goal % does not belong to user %', NEW.goal_id, NEW.user_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_goal_ownership ON public.transactions;
CREATE TRIGGER enforce_goal_ownership
  BEFORE INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_transaction_goal_ownership();


-- ── log_activity ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_activity(p_user_id UUID, p_xp INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.activity_log (user_id, activity_date, xp_earned, actions_count)
  VALUES (p_user_id, CURRENT_DATE, p_xp, 1)
  ON CONFLICT (user_id, activity_date)
  DO UPDATE SET
    xp_earned     = activity_log.xp_earned + p_xp,
    actions_count = activity_log.actions_count + 1;
END;
$$;


-- ── record_app_open ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_app_open(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  current_hour  INTEGER := EXTRACT(HOUR FROM NOW() AT TIME ZONE 'Africa/Johannesburg');
  existing_hour INTEGER;
BEGIN
  SELECT last_notification_hour INTO existing_hour
  FROM public.profiles WHERE id = p_user_id;

  IF existing_hour IS NULL THEN
    UPDATE public.profiles SET last_notification_hour = current_hour WHERE id = p_user_id;
  ELSE
    UPDATE public.profiles
    SET last_notification_hour = ROUND(existing_hour * 0.8 + current_hour * 0.2)
    WHERE id = p_user_id;
  END IF;
END;
$$;


-- ── award_xp ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.award_xp(
  p_user_id UUID, p_source_type TEXT, p_source_id TEXT, p_xp INTEGER
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new_total INTEGER;
  v_current   INTEGER;
BEGIN
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

  INSERT INTO public.activity_log (user_id, activity_date, xp_earned, actions_count)
  VALUES (p_user_id, CURRENT_DATE, p_xp, 1)
  ON CONFLICT (user_id, activity_date)
  DO UPDATE SET
    xp_earned     = activity_log.xp_earned     + p_xp,
    actions_count = activity_log.actions_count + 1;

  RETURN jsonb_build_object('success', true, 'xp_awarded', p_xp, 'new_total', v_new_total);
END;
$$;

GRANT EXECUTE ON FUNCTION public.award_xp(UUID, TEXT, TEXT, INTEGER) TO authenticated;


-- ── complete_daily_quest ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_daily_quest(
  p_user_id UUID, p_quest_id TEXT, p_quest_date DATE, p_xp INTEGER
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result JSONB;
BEGIN
  SELECT public.award_xp(p_user_id, 'daily_quest', p_quest_date::TEXT, p_xp) INTO v_result;
  IF (v_result->>'reason') = 'already_awarded' THEN RETURN v_result; END IF;

  INSERT INTO public.daily_quest_logs (user_id, quest_id, quest_date, xp_earned)
  VALUES (p_user_id, p_quest_id, p_quest_date, p_xp)
  ON CONFLICT (user_id, quest_date) DO NOTHING;

  IF (v_result->>'xp_awarded')::INTEGER > 0 THEN
    UPDATE public.profiles SET daily_quests_completed = daily_quests_completed + 1 WHERE id = p_user_id;
  END IF;

  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.complete_daily_quest(UUID, TEXT, DATE, INTEGER) TO authenticated;


-- ── complete_weekly_quest ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_weekly_quest(
  p_user_id UUID, p_quest_id TEXT, p_week_start DATE, p_xp INTEGER
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result JSONB; v_rows INTEGER;
BEGIN
  UPDATE public.user_weekly_quests
  SET status = 'completed', completed_at = NOW(), xp_earned = p_xp
  WHERE user_id = p_user_id AND week_start = p_week_start AND status = 'active';
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RETURN jsonb_build_object('success', true, 'xp_awarded', 0, 'reason', 'already_awarded');
  END IF;

  SELECT public.award_xp(p_user_id, 'weekly_quest', p_week_start::TEXT, p_xp) INTO v_result;

  IF (v_result->>'xp_awarded')::INTEGER > 0 THEN
    UPDATE public.profiles SET weekly_quests_completed = weekly_quests_completed + 1 WHERE id = p_user_id;
  END IF;

  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.complete_weekly_quest(UUID, TEXT, DATE, INTEGER) TO authenticated;


-- ── complete_chain_step ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_chain_step(
  p_user_id UUID, p_chain_id TEXT, p_step INTEGER,
  p_step_xp INTEGER, p_is_last BOOLEAN, p_chain_xp INTEGER
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_step_result JSONB; v_chain_result JSONB;
  v_next_step   INTEGER := p_step + 1;
  v_rows        INTEGER;
BEGIN
  UPDATE public.quest_chain_progress
  SET current_step = CASE WHEN p_is_last THEN p_step ELSE v_next_step END,
      status       = CASE WHEN p_is_last THEN 'completed' ELSE 'active' END,
      completed_at = CASE WHEN p_is_last THEN NOW() ELSE NULL END
  WHERE user_id = p_user_id AND chain_id = p_chain_id
    AND status = 'active' AND current_step = p_step;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RETURN jsonb_build_object('success', true, 'xp_awarded', 0, 'reason', 'already_awarded');
  END IF;

  SELECT public.award_xp(p_user_id, 'chain_step', p_chain_id || ':' || p_step::TEXT, p_step_xp)
  INTO v_step_result;

  IF p_is_last AND p_chain_xp > 0 THEN
    SELECT public.award_xp(p_user_id, 'chain_complete', p_chain_id, p_chain_xp) INTO v_chain_result;
    UPDATE public.profiles SET quest_chains_completed = quest_chains_completed + 1 WHERE id = p_user_id;
  END IF;

  RETURN jsonb_build_object(
    'success',    true,
    'xp_awarded', COALESCE((v_step_result->>'xp_awarded')::INTEGER, 0)
                + COALESCE((v_chain_result->>'xp_awarded')::INTEGER, 0),
    'new_total',  COALESCE((v_chain_result->>'new_total')::INTEGER,
                            (v_step_result->>'new_total')::INTEGER, 0)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.complete_chain_step(UUID, TEXT, INTEGER, INTEGER, BOOLEAN, INTEGER) TO authenticated;


-- ── complete_event ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_event(
  p_user_id UUID, p_event_slug TEXT, p_xp INTEGER
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result JSONB; v_rows INTEGER;
BEGIN
  UPDATE public.user_event_participation
  SET status = 'completed', completed_at = NOW(), xp_earned = p_xp
  WHERE user_id = p_user_id AND event_slug = p_event_slug AND status = 'active';
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RETURN jsonb_build_object('success', true, 'xp_awarded', 0, 'reason', 'already_awarded');
  END IF;

  SELECT public.award_xp(p_user_id, 'event_complete', p_event_slug, p_xp) INTO v_result;
  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.complete_event(UUID, TEXT, INTEGER) TO authenticated;


-- ── award_achievement ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.award_achievement(
  p_user_id UUID, p_achievement_id TEXT, p_xp INTEGER
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result JSONB;
BEGIN
  INSERT INTO public.user_achievements (user_id, achievement_id, earned_at)
  VALUES (p_user_id, p_achievement_id, NOW())
  ON CONFLICT (user_id, achievement_id) DO NOTHING;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'xp_awarded', 0, 'reason', 'already_awarded');
  END IF;

  SELECT public.award_xp(p_user_id, 'achievement', p_achievement_id, p_xp) INTO v_result;
  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.award_achievement(UUID, TEXT, INTEGER) TO authenticated;


-- ── update_streak ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_streak(
  p_user_id UUID, p_today DATE, p_new_streak INTEGER,
  p_longest INTEGER, p_shields INTEGER, p_shields_used INTEGER
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.profiles
  SET last_active_date   = p_today,
      streak_days        = p_new_streak,
      longest_streak     = p_longest,
      streak_shields     = p_shields,
      total_shields_used = p_shields_used
  WHERE id = p_user_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_streak(UUID, DATE, INTEGER, INTEGER, INTEGER, INTEGER) TO authenticated;


-- ── upsert_daily_activity ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_daily_activity(
  p_user_id UUID, p_date DATE,
  p_app_opened BOOLEAN DEFAULT FALSE,
  p_deposit_delta INTEGER DEFAULT 0,
  p_xp_delta INTEGER DEFAULT 0,
  p_quest_delta INTEGER DEFAULT 0
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.analytics_daily_activity
    (user_id, date, app_opened, deposit_count, xp_gained, quests_completed, updated_at)
  VALUES
    (p_user_id, p_date, p_app_opened, p_deposit_delta, p_xp_delta, p_quest_delta, NOW())
  ON CONFLICT (user_id, date) DO UPDATE SET
    app_opened       = analytics_daily_activity.app_opened OR p_app_opened,
    deposit_count    = analytics_daily_activity.deposit_count    + p_deposit_delta,
    xp_gained        = analytics_daily_activity.xp_gained        + p_xp_delta,
    quests_completed = analytics_daily_activity.quests_completed + p_quest_delta,
    updated_at       = NOW();
END;
$$;


-- ── update_engagement_status ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_engagement_status(p_user_id UUID DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_today DATE := CURRENT_DATE;
BEGIN
  INSERT INTO public.user_engagement_status
    (user_id, status, last_active_date, days_since_active, updated_at)
  SELECT
    p.id,
    CASE
      WHEN p.last_active_date IS NULL        THEN 'active'
      WHEN v_today - p.last_active_date <= 3 THEN 'active'
      WHEN v_today - p.last_active_date <= 7 THEN 'at_risk'
      ELSE                                        'churned'
    END,
    p.last_active_date,
    COALESCE(v_today - p.last_active_date, 0),
    NOW()
  FROM public.profiles p
  WHERE (p_user_id IS NULL OR p.id = p_user_id)
  ON CONFLICT (user_id) DO UPDATE SET
    status            = EXCLUDED.status,
    last_active_date  = EXCLUDED.last_active_date,
    days_since_active = EXCLUDED.days_since_active,
    updated_at        = NOW();
END;
$$;


-- ── trg_refresh_engagement_status ────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_refresh_engagement_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.last_active_date IS DISTINCT FROM OLD.last_active_date THEN
    PERFORM public.update_engagement_status(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refresh_engagement_status_on_profile_update ON public.profiles;
CREATE TRIGGER refresh_engagement_status_on_profile_update
  AFTER UPDATE OF last_active_date ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_engagement_status();


-- ════════════════════════════════════════════════════════════
-- SEED DATA
-- ════════════════════════════════════════════════════════════

-- Challenges (from 001 + 002)
INSERT INTO public.challenges (title, description, type, xp_reward, duration_days) VALUES
  ('No Takeout Week',         'Avoid all takeout and delivery food for 7 days.',              'manual',   300, 7),
  ('Save R50 Daily',          'Log at least R50 in savings every single day this week.',      'manual',   350, 7),
  ('Weekend Spending Freeze', 'Make zero non-essential purchases this weekend (Sat + Sun).',  'manual',   250, 2),
  ('3-Day Kickstart',         'Log a saving 3 days in a row to build your streak.',           'manual',   150, 3),
  ('Coffee Blackout',         'No bought coffee for 5 days. Brew at home.',                  'manual',   200, 5),
  ('Round-Up Week',           'Every time you spend, log the round-up difference as savings.','manual',   300, 7),
  ('No Shopping Sunday',      'Zero shopping (online or in-store) this Sunday.',              'manual',   100, 1),
  ('Month-End Sprint',        'Save at least R500 before the month ends.',                    'manual',   500, 30),
  ('New Year, New Fund',      'Start a brand-new savings goal in January.',                   'seasonal', 500, 31),
  ('Black Friday Blackout',   'Make zero impulse purchases on Black Friday.',                 'seasonal', 600, 1),
  ('Tax Season Stash',        'Build your emergency fund — tax season reminder.',             'seasonal', 600, 30),
  ('Winter Warmer Fund',      'Save for a winter-specific expense in June/July.',             'seasonal', 400, 30),
  ('Year in Review',          'Log your total savings for the year this December.',           'seasonal', 800, 31)
ON CONFLICT DO NOTHING;

-- Update seasonal challenges with time-bound fields (from 006)
UPDATE public.challenges SET quest_type = 'annual_event', start_date = '2025-11-28', end_date = '2025-11-28', year_agnostic = TRUE WHERE title = 'Black Friday Blackout';
UPDATE public.challenges SET quest_type = 'annual_event', start_date = '2025-01-01', end_date = '2025-01-07', year_agnostic = TRUE WHERE title = 'New Year, New Fund';
UPDATE public.challenges SET quest_type = 'seasonal',     start_date = '2025-02-01', end_date = '2025-03-31' WHERE title = 'Tax Season Stash';
UPDATE public.challenges SET quest_type = 'seasonal',     start_date = '2025-12-01', end_date = '2025-12-31' WHERE title = 'Year in Review';

-- Seed events (from 0071/007)
INSERT INTO public.events (slug, title, description, emoji, event_type, xp_reward, available_from, available_until, is_annual, preview_days)
VALUES
  ('evt_double_xp_weekend',    'Double XP Weekend',       'Every saving logged this weekend earns double XP.',      '⚡', 'savequest', 400, NULL, NULL, FALSE, 0),
  ('evt_community_savings_week','Community Savings Week', 'SaveQuest community challenge — save every day this week.','🤝','savequest', 500, NULL, NULL, FALSE, 3)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.event_regions (event_id, region)
SELECT id, 'GLOBAL' FROM public.events
WHERE slug IN ('evt_double_xp_weekend', 'evt_community_savings_week')
ON CONFLICT DO NOTHING;

-- Back-fill engagement status for all users
SELECT public.update_engagement_status(NULL);