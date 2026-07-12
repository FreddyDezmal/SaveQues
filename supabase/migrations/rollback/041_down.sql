-- 040_down.sql
-- Rollback for 039_complete_challenge_rpc.sql
--
-- CAUTION: rolling this back reintroduces the bug it fixed — reverting
-- app/api/quest/challenge/complete/route.ts to call this function will
-- start failing (function not found) unless the route is *also* reverted
-- to its pre-fix direct-.update() form at the same time. Roll back the
-- application code and this migration together, never independently.
DROP FUNCTION IF EXISTS public.complete_challenge(UUID, UUID, INTEGER);