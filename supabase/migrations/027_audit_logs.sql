-- ─────────────────────────────────────────────────────────────────────────────
-- 027_audit_logs.sql
-- Sprint 10 — Part 4: Audit Logging System
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHY A NEW TABLE, NOT admin_audit_log
--   admin_audit_log (introduced in an earlier sprint) tracks ADMIN CRUD
--   actions on badges/quests/chains/events, with actor_id + before/after
--   JSON snapshots. It answers "what did an admin change."
--
--   audit_logs answers a different question: "what financial/business
--   events happened to THIS USER's account, ever, immutably" — goal
--   created/edited/deleted, deposits, withdrawals, account deletion. This
--   is the record you reach for when a user emails asking "where did my
--   R500 deposit go" six weeks from now, or when reconstructing what
--   happened to a deleted account. It is intentionally narrower in shape
--   (event_type + entity_id + metadata) than admin_audit_log's
--   before/after snapshot model, because most of these events ARE the
--   state change (a deposit doesn't have a "before" state to diff).
--
--   For the two admin events this migration is also asked to cover
--   (ADMIN_BADGE_CREATED, ADMIN_QUEST_CREATED), routes write to BOTH
--   tables: admin_audit_log keeps its existing rich before/after record,
--   and audit_logs gets a lightweight cross-reference row so a single
--   "what happened in this account/business" timeline query never needs
--   to join two tables to find an admin-originated event.
--
-- IMMUTABILITY
--   No UPDATE or DELETE policy exists for any role except the service
--   role (which the application never uses to mutate these rows — only
--   to insert). RLS prevents users from editing or deleting their own
--   audit trail. There is intentionally no "admin edit" path either —
--   if a row is wrong, the correct response is a new row, not editing
--   history.
--
-- RETENTION
--   No automatic deletion. This table is the financial/business record
--   of the application — it should be retained indefinitely, identically
--   to the transactions table it often describes. If storage cost ever
--   becomes a concern at large scale, the standard approach is to move
--   rows older than N years to cold storage (e.g. exported to S3/Glacier-
--   equivalent), not to delete them. This is explicitly NOT the same
--   retention policy as rate_limit_attempts (migration 026), which is
--   operational noise safe to prune after 24 hours — audit_logs rows
--   are the opposite: permanent business records.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Nullable because ACCOUNT_DELETED is written AFTER auth.users no longer
  -- exists (deletion cascades immediately via admin.deleteUser()). The
  -- route captures user_id as a plain UUID value here BEFORE deletion,
  -- but we cannot make this a FK to profiles(id) ON DELETE CASCADE,
  -- because that would delete the very audit row recording the deletion
  -- at the moment the cascade fires — destroying the evidence we're
  -- trying to keep. So user_id here is NOT a foreign key: it's a plain
  -- UUID column, intentionally outliving the user it refers to.
  user_id     UUID         NOT NULL,

  event_type  TEXT         NOT NULL,
  entity_type TEXT         NOT NULL,
  entity_id   TEXT,                    -- nullable: ACCOUNT_DELETED has no separate entity
  metadata    JSONB        NOT NULL DEFAULT '{}'::jsonb,
  request_id  TEXT,                    -- correlates to the originating HTTP request's logs/Sentry
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT audit_logs_event_type_check CHECK (event_type IN (
    'GOAL_CREATED', 'GOAL_EDITED', 'GOAL_DELETED',
    'DEPOSIT_CREATED', 'WITHDRAWAL_CREATED',
    'ACCOUNT_DELETED',
    'ADMIN_BADGE_CREATED', 'ADMIN_QUEST_CREATED'
  )),
  CONSTRAINT audit_logs_entity_type_check CHECK (entity_type IN (
    'goal', 'transaction', 'account', 'badge', 'quest'
  ))
);

-- Primary access pattern: "show me everything that happened to this user"
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created
  ON public.audit_logs(user_id, created_at DESC);

-- Secondary pattern: "show me the history of this specific goal/transaction"
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON public.audit_logs(entity_type, entity_id)
  WHERE entity_id IS NOT NULL;

-- Tertiary pattern: "how many GOAL_DELETED events happened this week" (ops/founder query)
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type_created
  ON public.audit_logs(event_type, created_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Users can view their OWN audit history (e.g. a future "account activity"
-- page) but can never insert, update, or delete — those are the
-- application's job via the service-role client, never the user's.
DROP POLICY IF EXISTS "Users can view own audit logs" ON public.audit_logs;
CREATE POLICY "Users can view own audit logs"
  ON public.audit_logs FOR SELECT
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policy for the authenticated role at all.
-- Only the service role (used server-side, never exposed to the browser)
-- can write to this table — enforced by Postgres role privileges, not RLS,
-- since the service role bypasses RLS by design in Supabase.