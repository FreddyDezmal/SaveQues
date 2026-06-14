-- ============================================================
-- Migration 006 — Time-bound quest events
-- ============================================================

-- Quest type enum
-- evergreen: always available
-- seasonal: date-range based
-- annual_event: recurring yearly event
-- campaign: one-off limited time
ALTER TABLE public.challenges
  ADD COLUMN IF NOT EXISTS quest_type    TEXT NOT NULL DEFAULT 'evergreen'
    CHECK (quest_type IN ('evergreen', 'seasonal', 'annual_event', 'campaign')),
  ADD COLUMN IF NOT EXISTS start_date    DATE,
  ADD COLUMN IF NOT EXISTS end_date      DATE,
  ADD COLUMN IF NOT EXISTS preview_days  INTEGER NOT NULL DEFAULT 3,
  -- How many days before start_date users can see (but not start) the event
  ADD COLUMN IF NOT EXISTS year_agnostic BOOLEAN NOT NULL DEFAULT FALSE;
  -- TRUE for annual events: only month+day matter, year is ignored

-- Index for fast availability queries
CREATE INDEX IF NOT EXISTS idx_challenges_dates
  ON public.challenges (quest_type, start_date, end_date)
  WHERE is_active = TRUE;

-- Seed: update existing seasonal challenges with proper dates
-- Black Friday — last Friday of November
UPDATE public.challenges
SET quest_type = 'annual_event',
    start_date = '2025-11-28',
    end_date   = '2025-11-28',
    year_agnostic = TRUE
WHERE title = 'Black Friday Blackout';

-- New Year
UPDATE public.challenges
SET quest_type = 'annual_event',
    start_date = '2025-01-01',
    end_date   = '2025-01-07',
    year_agnostic = TRUE
WHERE title = 'New Year, New Fund';

-- Month-End Sprint — available last 5 days of every month
-- Handled in application logic, not fixed dates

-- Tax Season (South Africa: Feb–Mar)
UPDATE public.challenges
SET quest_type = 'seasonal',
    start_date = '2025-02-01',
    end_date   = '2025-03-31'
WHERE title = 'Tax Season Stash';

-- December Sprint
UPDATE public.challenges
SET quest_type = 'seasonal',
    start_date = '2025-12-01',
    end_date   = '2025-12-31'
WHERE title = 'Year in Review';