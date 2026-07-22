-- ============================================================
-- 059_feature_flags.sql
-- Sprint 24 (Product Intelligence Platform) — Phase 4: Feature Flags
-- ============================================================
-- WHY A NEW MIGRATION INSTEAD OF REUSING SOMETHING
--   Audited existing tables/lib before writing this: there is no
--   feature-flag, rollout, or A/B-adjacent table anywhere in the schema
--   (grep confirms no "flag"/"experiment"/"variant" tables). This is
--   genuinely new infrastructure, not a duplicate of something else.
--
-- DESIGN
--   feature_flags            — one row per flag. Admin-managed.
--   feature_flag_overrides   — per-user force on/off, for QA and staged
--                               internal rollouts ("developer overrides"
--                               in the sprint brief). Small table, one
--                               row per (flag, user) pair.
--
--   Evaluation precedence (implemented in lib/featureFlags.ts, not SQL —
--   keeping the rule in one pure, unit-testable TS function rather than
--   splitting it across a DB function and app code):
--     1. Per-user override always wins (on or off).
--     2. enabled_environments — if the current deploy environment is in
--        this list, the flag is force-on regardless of rollout. This is
--        the "environment override" the brief asks for (e.g. always on
--        in development for the team building against it).
--     3. is_enabled = false is a hard kill switch — off for everyone.
--     4. Otherwise: deterministic hash(user_id, flag_key) bucketing
--        against rollout_percentage.
--
-- PRIVILEGE MODEL (matches every other admin-managed catalog table —
-- see badges/daily_quests in migration 016/018):
--   • authenticated users can SELECT feature_flags (every row) and their
--     OWN rows in feature_flag_overrides — both are needed client-side
--     to evaluate flags for the current user, and neither table holds
--     anything sensitive (no secrets, no other users' data).
--   • No INSERT/UPDATE/DELETE policy is granted to `authenticated` on
--     either table. All writes go through the admin API routes using
--     the service-role client + requireAdmin(), exactly like every
--     other admin CRUD surface in this codebase.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.feature_flags (
  key                   TEXT PRIMARY KEY CHECK (key ~ '^[a-z0-9_]+$'),
  name                  TEXT NOT NULL,
  description           TEXT,
  is_enabled            BOOLEAN NOT NULL DEFAULT false,
  rollout_percentage    SMALLINT NOT NULL DEFAULT 0 CHECK (rollout_percentage BETWEEN 0 AND 100),
  -- Deploy environments (e.g. 'development', 'preview', 'production' —
  -- matches process.env.VERCEL_ENV / NODE_ENV values used elsewhere in
  -- lib/env.ts) in which this flag is force-enabled regardless of
  -- is_enabled/rollout_percentage. Empty array = no environment override.
  enabled_environments  TEXT[] NOT NULL DEFAULT '{}',
  created_by            UUID REFERENCES public.profiles(id),
  updated_by            UUID REFERENCES public.profiles(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.feature_flag_overrides (
  flag_key    TEXT NOT NULL REFERENCES public.feature_flags(key) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_enabled  BOOLEAN NOT NULL,
  reason      TEXT,
  created_by  UUID REFERENCES public.profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (flag_key, user_id)
);

CREATE INDEX IF NOT EXISTS idx_feature_flag_overrides_user_id
  ON public.feature_flag_overrides(user_id);

-- ── updated_at maintenance — reuses the existing trigger function from
--    migration 016 rather than defining a new one. ──────────────────────
DROP TRIGGER IF EXISTS trg_feature_flags_updated_at ON public.feature_flags;
CREATE TRIGGER trg_feature_flags_updated_at
  BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.feature_flags         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_flag_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read all flags" ON public.feature_flags;
CREATE POLICY "Authenticated users can read all flags"
  ON public.feature_flags
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Users can read own flag overrides" ON public.feature_flag_overrides;
CREATE POLICY "Users can read own flag overrides"
  ON public.feature_flag_overrides
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- No write policies for `authenticated` on either table by design — see
-- header. Writes go through app/api/admin/feature-flags/* using the
-- service-role client (createServiceClient(), bypasses RLS) after
-- requireAdmin() has verified the caller is an admin.

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================
-- SELECT * FROM public.feature_flags;
-- SELECT * FROM public.feature_flag_overrides;
-- SELECT polname, tablename FROM pg_policies WHERE tablename IN ('feature_flags', 'feature_flag_overrides');
-- Expected: exactly one SELECT policy per table, zero INSERT/UPDATE/DELETE policies for `authenticated`.
-- ============================================================
