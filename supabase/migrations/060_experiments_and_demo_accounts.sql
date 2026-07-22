-- ============================================================
-- 060_experiments_and_demo_accounts.sql
-- Sprint 24 (Product Intelligence Platform) — Phase 5 (Experimentation)
-- and Phase 8 (Internal Developer Console — demo-account safety gate).
-- ============================================================
-- TWO THINGS IN ONE MIGRATION, DELIBERATELY GROUPED:
--   1. profiles.is_demo — the single safety gate every dev-console admin
--      action (award XP, reset streak, simulate deposit, replay
--      onboarding, impersonate) checks before touching a user's row.
--   2. experiments / experiment_assignments — the A/B testing framework.
--   They're unrelated features but both are small, both are prerequisites
--   for the dev-console routes and experiments API being added in this
--   same change, and splitting them into two migrations here would only
--   add ceremony, not safety — neither depends on data seeded by the
--   other, so the ordering risk a combined migration usually carries
--   doesn't apply.
--
-- WHY is_demo EXISTS AT ALL — read before writing any dev-console route
--   This app has NO existing status/lifecycle flag that distinguishes a
--   real user's account from a QA/test account (confirmed by grep before
--   writing this — no is_demo/demo_account/is_test_account anywhere).
--   The Sprint 24 brief's "Internal Developer Console" explicitly asks
--   for actions that would be genuinely dangerous run against a real
--   user's real financial data in a fintech app: crediting arbitrary XP,
--   resetting a real streak, inserting a FAKE DEPOSIT into someone's
--   real transaction history, or generating a session that lets an
--   admin browse the app AS that user. Every one of those actions in
--   app/api/admin/dev-console/* refuses outright unless the target
--   profiles row has is_demo = true. This column is what makes that
--   refusal possible — without it, "gate to demo accounts only" would
--   have nothing to check against, and the honest thing to do would be
--   to not build these routes at all rather than build them ungated.
--
-- EXPERIMENTS DESIGN
--   experiments            — one row per experiment. Admin-managed,
--                             mirrors feature_flags' shape/RLS approach
--                             (migration 059) for consistency.
--   experiment_assignments — sticky per-(experiment, user) variant
--                             assignment. Unlike feature_flag_overrides,
--                             THIS table is written by ordinary
--                             authenticated users (via GET /api/experiments,
--                             lib/experiments.ts), not just admins — a
--                             user's own assignment is created lazily the
--                             first time they're evaluated for an
--                             experiment, then never changes (RLS below
--                             grants INSERT but not UPDATE/DELETE to
--                             `authenticated`, enforcing "assignment
--                             persistence" from the brief at the DB
--                             layer, not just in application code).
--   Variant weights (traffic split) live in `experiments.variants` as
--   JSONB rather than a separate table — kept deliberately simple for a
--   first version; a JSONB CHECK constraint can't meaningfully validate
--   "weights sum to something sane" without a trigger, so that
--   validation lives in lib/experiments.ts instead (validateVariants()),
--   documented there rather than silently skipped here.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_demo IS
  'Gate for app/api/admin/dev-console/* routes — those routes refuse to act on any profile where this is false. Never set true on a real user account.';

CREATE TABLE IF NOT EXISTS public.experiments (
  key                          TEXT PRIMARY KEY CHECK (key ~ '^[a-z0-9_]+$'),
  name                         TEXT NOT NULL,
  description                  TEXT,
  status                       TEXT NOT NULL DEFAULT 'draft'
                                  CHECK (status IN ('draft', 'running', 'completed', 'archived')),
  -- Array of { id: string, name: string, weight: number }. Weights are
  -- relative, not required to sum to 100 — lib/experiments.ts normalises
  -- them. Validated at the application layer (see file header).
  variants                     JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- What fraction of users are included in this experiment at all; the
  -- rest are excluded entirely (never assigned a variant, not even
  -- "control") rather than force-fit into it. 100 = everyone eligible.
  traffic_allocation_percentage SMALLINT NOT NULL DEFAULT 100
                                  CHECK (traffic_allocation_percentage BETWEEN 0 AND 100),
  created_by                   UUID REFERENCES public.profiles(id),
  updated_by                   UUID REFERENCES public.profiles(id),
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.experiment_assignments (
  experiment_key  TEXT NOT NULL REFERENCES public.experiments(key) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  variant_id      TEXT NOT NULL,
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (experiment_key, user_id)
);

CREATE INDEX IF NOT EXISTS idx_experiment_assignments_user_id
  ON public.experiment_assignments(user_id);

DROP TRIGGER IF EXISTS trg_experiments_updated_at ON public.experiments;
CREATE TRIGGER trg_experiments_updated_at
  BEFORE UPDATE ON public.experiments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.experiments             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiment_assignments  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read all experiments" ON public.experiments;
CREATE POLICY "Authenticated users can read all experiments"
  ON public.experiments
  FOR SELECT
  TO authenticated
  USING (true);
-- No write policy for `authenticated` — admin-only, via the service-role
-- client in app/api/admin/experiments/*, same as feature_flags.

DROP POLICY IF EXISTS "Users can read own experiment assignments" ON public.experiment_assignments;
CREATE POLICY "Users can read own experiment assignments"
  ON public.experiment_assignments
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own experiment assignment" ON public.experiment_assignments;
CREATE POLICY "Users can create own experiment assignment"
  ON public.experiment_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
-- Deliberately NO UPDATE or DELETE policy for `authenticated` — this is
-- what makes an assignment sticky at the database layer, not just by
-- application convention. Once a row exists for (experiment_key, user_id)
-- it cannot be changed by the user it belongs to.

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================
-- SELECT is_demo FROM public.profiles LIMIT 1;
-- SELECT * FROM public.experiments;
-- SELECT * FROM public.experiment_assignments;
-- SELECT polname, tablename, cmd FROM pg_policies WHERE tablename IN ('experiments', 'experiment_assignments');
-- Expected: experiments has 1 SELECT policy only; experiment_assignments
-- has 1 SELECT + 1 INSERT policy, no UPDATE/DELETE for `authenticated`.
-- ============================================================
