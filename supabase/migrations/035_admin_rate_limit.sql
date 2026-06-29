-- ─────────────────────────────────────────────────────────────────────────────
-- 035_admin_rate_limit.sql
-- Sprint 13 — P1-B: Admin route rate limiting support indexes
-- ─────────────────────────────────────────────────────────────────────────────
-- No new tables — reuses rate_limit_attempts (026) and audit_logs (027).
-- Adds targeted indexes for the admin endpoint access patterns.
-- ─────────────────────────────────────────────────────────────────────────────

-- Index for admin rate limit check: user_id + endpoint + created_at window
CREATE INDEX IF NOT EXISTS idx_rate_limit_admin
  ON public.rate_limit_attempts(user_id, endpoint, created_at DESC)
  WHERE endpoint = 'admin.users';

-- Index for admin audit log queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_access
  ON public.audit_logs(user_id, created_at DESC)
  WHERE event_type = 'ADMIN_DATA_ACCESS';