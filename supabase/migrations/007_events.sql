-- ============================================================
-- SaveQuest Migration 007 — Event System
-- Time-bound quests, regional events, user participation
-- ============================================================

-- ── EVENTS TABLE ─────────────────────────────────────────────
-- Stores admin-created one-off campaigns and seasonal events.
-- Static/recurring events live in lib/events.ts.
CREATE TABLE IF NOT EXISTS public.events (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Unique slug — matches ids in lib/events.ts for hybrid lookup
  slug             TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL,
  emoji            TEXT NOT NULL DEFAULT '⚡',
  event_type       TEXT NOT NULL DEFAULT 'seasonal'
                   CHECK (event_type IN ('seasonal', 'calendar', 'savequest', 'evergreen')),
  xp_reward        INTEGER NOT NULL DEFAULT 200,

  -- Availability window — NULL = open-ended
  available_from   DATE,
  available_until  DATE,

  -- Annual events ignore the year component
  is_annual        BOOLEAN NOT NULL DEFAULT FALSE,

  -- Preview window in days before available_from
  preview_days     INTEGER NOT NULL DEFAULT 5,

  -- Soft delete / admin toggle
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Anyone can read active events
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read active events" ON public.events
  FOR SELECT USING (is_active = TRUE);

-- ── EVENT REGIONS ─────────────────────────────────────────────
-- Many-to-many: one event can target multiple regions
CREATE TABLE IF NOT EXISTS public.event_regions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id   UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  -- "GLOBAL" means visible everywhere
  region     TEXT NOT NULL CHECK (region IN ('GLOBAL','ZA','US','GB','AU','CA','NG','KE','IN'))
);

ALTER TABLE public.event_regions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read event regions" ON public.event_regions
  FOR SELECT USING (TRUE);

CREATE INDEX IF NOT EXISTS idx_event_regions_event_id ON public.event_regions(event_id);
CREATE INDEX IF NOT EXISTS idx_event_regions_region   ON public.event_regions(region);

-- ── USER EVENT PARTICIPATION ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_event_participation (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- References either events.id (DB events) or a static slug from lib/events.ts
  event_slug   TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'completed', 'expired')),
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  xp_earned    INTEGER,
  UNIQUE (user_id, event_slug)
);

ALTER TABLE public.user_event_participation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own event participation" ON public.user_event_participation
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_uep_user_id    ON public.user_event_participation(user_id);
CREATE INDEX IF NOT EXISTS idx_uep_event_slug ON public.user_event_participation(event_slug);

-- ── INDEXES FOR AVAILABILITY QUERIES ─────────────────────────
CREATE INDEX IF NOT EXISTS idx_events_dates
  ON public.events (available_from, available_until)
  WHERE is_active = TRUE;

-- ── SEED: Example admin-created campaign ─────────────────────
-- One-off events that don't belong in static code go here
INSERT INTO public.events (slug, title, description, emoji, event_type, xp_reward, available_from, available_until, is_annual, preview_days)
VALUES
  ('evt_double_xp_weekend', 'Double XP Weekend', 'Every saving logged this weekend earns double XP.', '⚡', 'savequest', 400, NULL, NULL, FALSE, 0),
  ('evt_community_savings_week', 'Community Savings Week', 'SaveQuest community challenge — save every day this week.', '🤝', 'savequest', 500, NULL, NULL, FALSE, 3)
ON CONFLICT (slug) DO NOTHING;

-- Seed regions for the two above (GLOBAL)
INSERT INTO public.event_regions (event_id, region)
SELECT id, 'GLOBAL' FROM public.events WHERE slug IN ('evt_double_xp_weekend', 'evt_community_savings_week')
ON CONFLICT DO NOTHING;

-- ── ADD country_code TO PROFILES IF MISSING ──────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS country_code TEXT NOT NULL DEFAULT 'ZA';
