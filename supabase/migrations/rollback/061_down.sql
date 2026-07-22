-- ─────────────────────────────────────────────────────────────────────────────
-- 061_down.sql
-- Rollback for 061_admin_award_xp.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Drops the function. Safe to run any time — nothing else in the schema
-- depends on admin_award_xp() (it's a leaf function, called only from
-- app/api/admin/dev-console/award-xp/route.ts). Rows already written to
-- xp_awards/profiles.xp_total by past calls are untouched, same as
-- award_xp() itself would be if it were ever dropped — this only removes
-- the ability to make NEW admin XP grants, not past ones.
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.admin_award_xp(UUID, TEXT, INTEGER, DATE);
