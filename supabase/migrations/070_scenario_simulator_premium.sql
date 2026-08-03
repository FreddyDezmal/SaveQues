-- supabase/migrations/070_scenario_simulator_premium.sql
-- ─────────────────────────────────────────────────────────────
-- Sprint 30 — Phase 3: Scenario Simulator Upgrade.
--
-- AUDIT NOTE (Sprint 30 Phase 1): lib/scenarioSimulator.ts and
-- components/goals/ScenarioSimulatorCard.tsx already exist (Sprint 28)
-- and scenario comparison already exists (Sprint 28.5, Phase 6 — the
-- ScenarioBar visualization). This migration does not touch either.
-- What Phase 1 found missing:
--   1. `scenarios_limit` was seeded onto both plans back in migration 069
--      (free: 3/day, premium: unlimited) but nothing ever calls
--      checkUsage()/enforceUsageLimit() for it — the simulator is a pure
--      client-side function with no server round-trip, so the "3/day"
--      cap described in the Sprint 28 brief was never actually
--      enforced. This migration doesn't change that cap; the API route
--      added alongside it (app/api/goal/scenario-run) is what enforces
--      the cap that already exists in plan_features.
--   2. "Multiple saved scenarios" (a genuinely new premium feature, not
--      in Sprint 28/28.5) needs a place to persist scenarios. That's
--      this migration's only new table.

-- ── saved_scenarios ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.saved_scenarios (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  goal_id       uuid NOT NULL REFERENCES public.savings_goals(id) ON DELETE CASCADE,
  -- Mirrors lib/scenarioSimulator.ts's ScenarioInput shape exactly —
  -- this table stores the INPUT a user chose to save, not a frozen
  -- computed result, so a saved scenario always re-simulates against the
  -- goal's current, up-to-date transaction history rather than showing a
  -- stale projection from whenever it was saved.
  scenario_type text NOT NULL CHECK (scenario_type IN ('weekly_delta', 'skip_payment', 'cadence_change', 'lump_sum')),
  amount        numeric(12,2),
  interval_days integer,
  label         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.saved_scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "saved_scenarios_crud_own"
  ON public.saved_scenarios FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_saved_scenarios_user_goal ON public.saved_scenarios (user_id, goal_id);

-- ── feature: saved_scenarios_limit ──────────────────────────────────────
-- 'limit' kind, 'lifetime' reset — same shape as goals_limit (migration
-- 069's comment on that column explains why: a count of currently-saved
-- rows, not an append-only counter, so app/api/goal/scenario-saved
-- counts live rows via getFeatureLimit() the same way
-- app/api/goals/route.ts already does for goals_limit, rather than going
-- through lib/billing/usage.ts's usage_counters.
INSERT INTO public.features (key, name, description, kind, usage_unit, reset_period, sort_order) VALUES
  ('saved_scenarios_limit', 'Saved scenarios', 'Scenarios you can save per goal for later comparison.', 'limit', 'saved_scenarios', 'lifetime', 9)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.plan_features (plan_id, feature_key, is_enabled, limit_value) VALUES
  ('free', 'saved_scenarios_limit', true, 1)
ON CONFLICT (plan_id, feature_key) DO NOTHING;

INSERT INTO public.plan_features (plan_id, feature_key, is_enabled, limit_value) VALUES
  ('premium', 'saved_scenarios_limit', true, NULL)
ON CONFLICT (plan_id, feature_key) DO NOTHING;

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================
-- SELECT * FROM features WHERE key = 'saved_scenarios_limit';
-- SELECT p.id AS plan, pf.limit_value FROM plan_features pf JOIN plans p ON p.id = pf.plan_id WHERE pf.feature_key = 'saved_scenarios_limit';
