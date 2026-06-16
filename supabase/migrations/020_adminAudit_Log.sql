-- ============================================================
-- SaveQuest Migration 020 — Admin Audit Log (M4)
-- ============================================================
-- Creates the admin_audit_log table used by all admin CRUD routes.
-- Rows are written by the application (service_role client) and
-- are read-only to all authenticated users via RLS.
-- service_role bypasses RLS entirely — no SELECT policy needed
-- for admin dashboard queries.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  action       TEXT        NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DELETE')),
  entity_type  TEXT        NOT NULL,   -- 'badge' | 'daily_quest' | 'weekly_quest' | 'quest_chain' | 'challenge' | 'event'
  entity_id    TEXT        NOT NULL,   -- the primary key of the affected record (TEXT to cover both UUID and slug ids)
  before_state JSONB,                  -- full row snapshot before UPDATE/DELETE; NULL for CREATE
  after_state  JSONB,                  -- full row snapshot after CREATE/UPDATE; NULL for DELETE
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for the two most common investigation queries:
--   1. "what did actor X do?"
--   2. "what happened to entity Y?"
CREATE INDEX IF NOT EXISTS idx_aal_actor_id    ON public.admin_audit_log (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aal_entity      ON public.admin_audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aal_created_at  ON public.admin_audit_log (created_at DESC);

-- RLS: authenticated users cannot read or write audit logs directly.
-- Admin dashboards query via service_role (bypasses RLS).
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- No policies: blocks all direct authenticated access.
-- service_role writes from the application API routes are unaffected.

-- ============================================================
-- EXAMPLE INVESTIGATION QUERIES
-- ============================================================
-- All actions by a specific admin in the last 7 days:
--   SELECT actor_id, action, entity_type, entity_id, created_at
--   FROM public.admin_audit_log
--   WHERE actor_id = '<uuid>'
--     AND created_at > NOW() - INTERVAL '7 days'
--   ORDER BY created_at DESC;
--
-- Full history of a specific badge:
--   SELECT action, before_state, after_state, actor_id, created_at
--   FROM public.admin_audit_log
--   WHERE entity_type = 'badge' AND entity_id = 'streak_365'
--   ORDER BY created_at DESC;
--
-- All DELETEs across all entity types this month:
--   SELECT entity_type, entity_id, actor_id, before_state, created_at
--   FROM public.admin_audit_log
--   WHERE action = 'DELETE'
--     AND created_at > date_trunc('month', NOW())
--   ORDER BY created_at DESC;
-- ============================================================