-- ─────────────────────────────────────────────────────────────────────────────
-- 069_down.sql
-- Rollback for 069_premium_subscriptions.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Drops all six new tables (CASCADE removes their policies/indexes/triggers
-- too). Genuine data loss: any live subscriptions, usage counters, and
-- webhook idempotency history are gone after this runs.
--
-- WARNING: after this runs, every route under app/api/billing/*, the
-- entitlement service (lib/billing/entitlements.ts), and any UI reading
-- plan/entitlement state will fail (missing tables) until that code is
-- rolled back too. Do not run this against a database with real paying
-- subscribers without first exporting subscriptions and reconciling with
-- the Stripe dashboard (Stripe remains the source of truth; this table is
-- a cache).
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.increment_usage_counter(uuid, text, date, integer);

DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON public.subscriptions;
DROP TRIGGER IF EXISTS trg_plans_updated_at ON public.plans;

DROP TABLE IF EXISTS public.billing_webhook_events;
DROP TABLE IF EXISTS public.usage_counters;
DROP TABLE IF EXISTS public.subscriptions;
DROP TABLE IF EXISTS public.plan_features;
DROP TABLE IF EXISTS public.features;
DROP TABLE IF EXISTS public.plans;

-- set_updated_at() is a generic shared helper — left in place in case other
-- tables already depend on it (introduced in an earlier migration if this
-- is not the first table to use it; check before dropping in a real rollback).
