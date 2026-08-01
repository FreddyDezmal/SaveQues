-- ─────────────────────────────────────────────────────────────────────────────
-- 069_premium_subscriptions.sql
-- Sprint 29 — Premium Subscription Platform.
--
-- AUDIT (see docs/BILLING_AUDIT.md): grepped every migration 001–068 and the
-- full app/lib/components tree before writing this. There is no premium
-- flag, subscription table, entitlement table, or billing-provider reference
-- anywhere in the schema or code. This is net-new infrastructure.
--
-- DESIGN — five tables, matching the brief's Subscription / Entitlement /
-- Plan / Feature / Usage domain model:
--
--   plans              — catalogue of purchasable tiers. Rows, not enum
--                         values or hardcoded strings, so "add a tier" is a
--                         data change, not a code change (Phase 3's
--                         "future-ready without modification" requirement).
--   features            — catalogue of gatable features/limits, each tagged
--                         with a `kind` (boolean toggle vs numeric limit).
--                         The UI and server both resolve entitlements by
--                         `feature_key`, never by plan name — this is what
--                         lets Phase 4 say "never duplicate feature checks".
--   plan_features        — join table: which features a plan grants, and at
--                         what limit (null limit = unlimited). This is the
--                         single source of truth Entitlement.ts reads from;
--                         no limit is hardcoded in TypeScript.
--   subscriptions        — one row per user's current subscription state.
--                         Mirrors the provider's subscription object closely
--                         enough to render a billing UI without a live API
--                         call, but the provider (Stripe) remains the source
--                         of truth — this table is a cache, kept in sync by
--                         webhooks (Phase 9), never trusted for
--                         security-sensitive decisions without a webhook
--                         signature having written it (Phase 14).
--   usage_counters        — period-scoped counters (e.g. exports this
--                         calendar month, scenarios today) that
--                         lib/billing/usage.ts increments and checks against
--                         plan_features.limit_value. Same "server decides,
--                         client reads" shape as
--                         financial_health_score_snapshots (067): no client
--                         INSERT/UPDATE/DELETE policy, only service-role
--                         writes via the API route that performs the gated
--                         action.
--   billing_webhook_events — idempotency ledger for Stripe webhook delivery.
--                         Stripe explicitly documents at-least-once, possibly
--                         out-of-order delivery and recommends persisting
--                         event IDs; this table is that ledger (Phase 9's
--                         "prevent duplicate processing" / "prevent replay").
--
-- All new tables reference public.profiles(id), same FK convention as every
-- other per-user table in this schema (see 067).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── plans ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.plans (
  id           text PRIMARY KEY,               -- e.g. 'free', 'premium'
  name         text NOT NULL,                  -- display name, e.g. 'Premium'
  description  text,
  price_cents  integer,                        -- monthly price in cents; null for free
  interval     text CHECK (interval IN ('month', 'year')) DEFAULT 'month',
  is_default   boolean NOT NULL DEFAULT false, -- the plan every new user starts on
  is_purchasable boolean NOT NULL DEFAULT true,-- 'free' is not purchasable, it's assigned
  sort_order   smallint NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

-- Plans are public catalogue data (needed to render the upgrade/comparison
-- UI to anyone, including signed-out visitors on a future marketing page) —
-- readable by everyone, writable by no client (admin-only, via service role,
-- same as badges/quest-content admin tables in 016/057).
CREATE POLICY "plans_select_all"
  ON public.plans FOR SELECT USING (true);

-- ── features ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.features (
  key          text PRIMARY KEY,               -- e.g. 'unlimited_goals', 'ai_coaching'
  name         text NOT NULL,                  -- display name
  description  text,
  kind         text NOT NULL CHECK (kind IN ('boolean', 'limit')),
  -- For kind='limit' features, the unit this limit counts (e.g. 'goals',
  -- 'exports_per_month', 'scenarios_per_day'). Null for kind='boolean'.
  usage_unit   text,
  -- Reset cadence for kind='limit' features that are period-scoped.
  -- 'lifetime' = never resets (e.g. total active goals), 'day' / 'month'
  -- reset the counter on UTC day/month boundaries.
  reset_period text CHECK (reset_period IN ('lifetime', 'day', 'month')),
  sort_order   smallint NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT features_limit_needs_unit_and_period
    CHECK (kind = 'boolean' OR (usage_unit IS NOT NULL AND reset_period IS NOT NULL))
);

ALTER TABLE public.features ENABLE ROW LEVEL SECURITY;

CREATE POLICY "features_select_all"
  ON public.features FOR SELECT USING (true);

-- ── plan_features ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.plan_features (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id      text NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  feature_key  text NOT NULL REFERENCES public.features(key) ON DELETE CASCADE,
  -- boolean features: is it granted at all. limit features: the numeric
  -- ceiling (null = unlimited, i.e. the entitlement is granted with no cap).
  is_enabled   boolean NOT NULL DEFAULT true,
  limit_value  integer,
  CONSTRAINT plan_features_unique UNIQUE (plan_id, feature_key),
  CONSTRAINT plan_features_limit_nonneg CHECK (limit_value IS NULL OR limit_value >= 0)
);

ALTER TABLE public.plan_features ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plan_features_select_all"
  ON public.plan_features FOR SELECT USING (true);

-- ── subscriptions ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_id                text NOT NULL REFERENCES public.plans(id),
  status                 text NOT NULL CHECK (status IN (
                           'active', 'trialing', 'past_due', 'canceled',
                           'incomplete', 'incomplete_expired', 'unpaid'
                         )),
  -- Which billing provider this subscription lives in, and that provider's
  -- own IDs — kept generic (not "stripe_customer_id") so a second provider
  -- adapter (Phase 6) doesn't require a schema migration, only a new row
  -- shape under the same columns.
  provider               text NOT NULL DEFAULT 'stripe',
  provider_customer_id   text,
  provider_subscription_id text,
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  canceled_at            timestamptz,
  trial_end              timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  -- One row per user: a user has exactly one current subscription record.
  -- Plan changes (upgrade/downgrade/cancel) update this row in place;
  -- history of changes is reconstructable from billing_webhook_events, not
  -- duplicated here (avoids a second source of truth to keep in sync).
  CONSTRAINT subscriptions_user_unique UNIQUE (user_id),
  CONSTRAINT subscriptions_provider_sub_unique UNIQUE (provider, provider_subscription_id)
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Server-decides-client-reads shape (same as financial_health_score_snapshots,
-- 067): a user may read their own subscription row to render billing UI, but
-- every write goes through a webhook or a service-role route — never a
-- direct client UPDATE, which is exactly the "never trust client-side
-- premium flags" requirement from Phase 14.
CREATE POLICY "subscriptions_select_own"
  ON public.subscriptions FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON public.subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_provider_customer ON public.subscriptions (provider, provider_customer_id);

-- ── usage_counters ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.usage_counters (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  feature_key   text NOT NULL REFERENCES public.features(key) ON DELETE CASCADE,
  -- The period this counter applies to: for reset_period='day' this is the
  -- UTC date; for 'month' the first-of-month UTC date; for 'lifetime' a
  -- fixed sentinel date (epoch) so the unique constraint below still works
  -- with a single row per user+feature.
  period_start  date NOT NULL,
  count         integer NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usage_counters_unique UNIQUE (user_id, feature_key, period_start),
  CONSTRAINT usage_counters_count_nonneg CHECK (count >= 0)
);

ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usage_counters_select_own"
  ON public.usage_counters FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_usage_counters_user_feature
  ON public.usage_counters (user_id, feature_key, period_start DESC);

-- ── billing_webhook_events ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.billing_webhook_events (
  id            text PRIMARY KEY,   -- the provider's own event id, e.g. Stripe's evt_...
  provider      text NOT NULL DEFAULT 'stripe',
  event_type    text NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  status        text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'failed')),
  error         text
);

ALTER TABLE public.billing_webhook_events ENABLE ROW LEVEL SECURITY;
-- No client policies at all — this table is never read or written by an
-- authenticated user session, only by the webhook route via the
-- service-role client (same as admin_audit_log, 016).

CREATE INDEX IF NOT EXISTS idx_billing_webhook_events_type
  ON public.billing_webhook_events (event_type, received_at DESC);

-- ── increment_usage_counter() ────────────────────────────────────────────────
-- Atomic upsert-and-increment, called by lib/billing/usage.ts's
-- recordUsage() via supabase.rpc(...). Needed because a plain
-- read-then-write from the client (SELECT count, then UPDATE count+1)
-- races under concurrent requests from the same user (two exports fired
-- in quick succession could both read count=4 and both write count=5,
-- undercounting by one) — a single atomic statement avoids that.
CREATE OR REPLACE FUNCTION public.increment_usage_counter(
  p_user_id uuid,
  p_feature_key text,
  p_period_start date,
  p_amount integer DEFAULT 1
) RETURNS void AS $$
BEGIN
  INSERT INTO public.usage_counters (user_id, feature_key, period_start, count)
  VALUES (p_user_id, p_feature_key, p_period_start, p_amount)
  ON CONFLICT (user_id, feature_key, period_start)
  DO UPDATE SET count = public.usage_counters.count + p_amount, updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- SECURITY DEFINER is required because usage_counters has no client
-- INSERT/UPDATE policy (server-decides-client-reads, see table comment
-- above) — this function is the one sanctioned write path, and it's only
-- ever invoked via the service-role client from lib/billing/usage.ts,
-- never exposed directly to an authenticated client session.
REVOKE ALL ON FUNCTION public.increment_usage_counter FROM PUBLIC, anon, authenticated;

-- ── updated_at triggers (reuse existing helper if present, else define) ─────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    CREATE FUNCTION public.set_updated_at() RETURNS trigger AS $f$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $f$ LANGUAGE plpgsql;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_plans_updated_at ON public.plans;
CREATE TRIGGER trg_plans_updated_at BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── seed: plans ─────────────────────────────────────────────────────────────
INSERT INTO public.plans (id, name, description, price_cents, interval, is_default, is_purchasable, sort_order) VALUES
  ('free',    'Free',    'Everything you need to start building good savings habits.', NULL, 'month', true,  false, 0),
  ('premium', 'Premium', 'Unlimited goals, deeper insights, and AI-powered coaching.',  999,  'month', false, true,  1)
ON CONFLICT (id) DO NOTHING;

-- ── seed: features ──────────────────────────────────────────────────────────
INSERT INTO public.features (key, name, description, kind, usage_unit, reset_period, sort_order) VALUES
  ('goals_limit',          'Savings goals',        'Active savings goals you can track at once.',        'limit',   'goals',              'lifetime', 0),
  ('exports_limit',        'Data exports',         'CSV/report exports.',                                 'limit',   'exports_per_month',  'month',    1),
  ('scenarios_limit',      'What-if scenarios',    'Scenario simulator runs.',                             'limit',   'scenarios_per_day',  'day',      2),
  ('advanced_analytics',   'Advanced analytics',   'Deeper spending/category breakdowns and trends.',      'boolean', NULL,                 NULL,       3),
  ('ai_coaching',          'AI coaching',          'Personalized AI-generated financial coaching.',        'boolean', NULL,                 NULL,       4),
  ('unlimited_exports',    'Unlimited exports',    'No monthly cap on exports.',                           'boolean', NULL,                 NULL,       5),
  ('historical_insights',  'Historical insights',  'Full history beyond the free-tier lookback window.',   'boolean', NULL,                 NULL,       6),
  ('advanced_forecasting', 'Advanced forecasting', 'Extended cash-flow projection horizon and models.',    'boolean', NULL,                 NULL,       7),
  ('priority_reminders',   'Priority reminders',   'Finer-grained, higher-frequency reminder scheduling.', 'boolean', NULL,                 NULL,       8)
ON CONFLICT (key) DO NOTHING;

-- ── seed: plan_features ─────────────────────────────────────────────────────
-- Free tier: numeric limits per the brief (5 goals, 5 exports/month,
-- 3 scenarios/day), no boolean premium features.
INSERT INTO public.plan_features (plan_id, feature_key, is_enabled, limit_value) VALUES
  ('free', 'goals_limit',     true, 5),
  ('free', 'exports_limit',   true, 5),
  ('free', 'scenarios_limit', true, 3)
ON CONFLICT (plan_id, feature_key) DO NOTHING;

-- Premium tier: unlimited on every limit feature (null = unlimited) plus
-- every boolean feature enabled.
INSERT INTO public.plan_features (plan_id, feature_key, is_enabled, limit_value) VALUES
  ('premium', 'goals_limit',          true, NULL),
  ('premium', 'exports_limit',        true, NULL),
  ('premium', 'scenarios_limit',      true, NULL),
  ('premium', 'advanced_analytics',   true, NULL),
  ('premium', 'ai_coaching',          true, NULL),
  ('premium', 'unlimited_exports',    true, NULL),
  ('premium', 'historical_insights',  true, NULL),
  ('premium', 'advanced_forecasting', true, NULL),
  ('premium', 'priority_reminders',   true, NULL)
ON CONFLICT (plan_id, feature_key) DO NOTHING;

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================
-- SELECT * FROM plans ORDER BY sort_order;
-- SELECT p.id AS plan, f.key AS feature, pf.is_enabled, pf.limit_value
--   FROM plan_features pf
--   JOIN plans p ON p.id = pf.plan_id
--   JOIN features f ON f.key = pf.feature_key
--   ORDER BY p.sort_order, f.sort_order;
-- SELECT tablename FROM pg_tables WHERE schemaname = 'public'
--   AND tablename IN ('plans','features','plan_features','subscriptions',
--                      'usage_counters','billing_webhook_events');
-- Expected: 6 rows.
-- ============================================================
