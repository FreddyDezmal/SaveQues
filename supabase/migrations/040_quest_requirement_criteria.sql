-- 040_quest_requirement_criteria.sql
--
-- Admin CRUD audit finding (docs/ADMIN_CRUD_AUDIT.md, Sprint "admin audit"):
-- daily_quests and weekly_quests had no structured way to express *what*
-- must actually be true for a quest to be considered done — the completion
-- API routes trusted the client's "I did it" click at face value. This
-- migration adds an optional, backward-compatible requirement_type /
-- requirement_value pair so admins can specify real, checkable criteria
-- (e.g. "streak >= 7") going forward.
--
-- Backward compatible by construction: every existing row gets
-- requirement_type = 'none', which app/api/quest/daily/complete/route.ts
-- and app/api/quest/weekly/complete/route.ts treat exactly like today's
-- behavior (self-reported completion) — nothing that previously worked
-- becomes blocked by this migration on its own. Only quests an admin
-- explicitly sets a requirement on going forward will be checked.

ALTER TABLE public.daily_quests
  ADD COLUMN IF NOT EXISTS requirement_type  TEXT    NOT NULL DEFAULT 'none'
              CHECK (requirement_type IN ('none','streak','save_amount')),
  ADD COLUMN IF NOT EXISTS requirement_value INTEGER NOT NULL DEFAULT 0
              CHECK (requirement_value >= 0);

ALTER TABLE public.weekly_quests
  ADD COLUMN IF NOT EXISTS requirement_type  TEXT    NOT NULL DEFAULT 'none'
              CHECK (requirement_type IN ('none','streak','save_amount')),
  ADD COLUMN IF NOT EXISTS requirement_value INTEGER NOT NULL DEFAULT 0
              CHECK (requirement_value >= 0);

COMMENT ON COLUMN public.daily_quests.requirement_type IS
  'Structured, server-checkable requirement. ''none'' = self-reported (legacy behavior, still trust-the-client). ''streak''/''save_amount'' are verified server-side in app/api/quest/daily/complete/route.ts before XP is awarded.';
COMMENT ON COLUMN public.weekly_quests.requirement_type IS
  'Structured, server-checkable requirement. ''none'' = self-reported (legacy behavior, still trust-the-client). ''streak''/''save_amount'' are verified server-side in app/api/quest/weekly/complete/route.ts before XP is awarded.';
