-- 036_down.sql
-- Rollback for 036_dashboard_timing.sql
DROP FUNCTION IF EXISTS public.get_dashboard_p95(INTEGER);
DROP FUNCTION IF EXISTS public.cleanup_old_dashboard_timings();
DROP TABLE IF EXISTS public.dashboard_timings;