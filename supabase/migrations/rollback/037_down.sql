-- ─────────────────────────────────────────────────────────────────────────────
-- 037_down.sql
-- Rollback for 037_purchase_shield_rpc.sql
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.purchase_shield(UUID, INTEGER, INTEGER) FROM authenticated;
DROP FUNCTION IF EXISTS public.purchase_shield(UUID, INTEGER, INTEGER);