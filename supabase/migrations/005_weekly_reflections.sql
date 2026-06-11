-- Migration 005 — ensure weekly_reflections RLS is active
-- (Belt-and-suspenders check in case migration 004 didn't apply it)

ALTER TABLE public.weekly_reflections ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'weekly_reflections'
    AND policyname = 'Users can CRUD own reflections'
  ) THEN
    CREATE POLICY "Users can CRUD own reflections" ON public.weekly_reflections
      FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

-- Also ensure settings-related columns exist (idempotent)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notification_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS reflection_day TEXT NOT NULL DEFAULT 'sunday';-- Migration 005 — ensure weekly_reflections RLS is active
-- (Belt-and-suspenders check in case migration 004 didn't apply it)

ALTER TABLE public.weekly_reflections ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'weekly_reflections'
    AND policyname = 'Users can CRUD own reflections'
  ) THEN
    CREATE POLICY "Users can CRUD own reflections" ON public.weekly_reflections
      FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

-- Also ensure settings-related columns exist (idempotent)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notification_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS reflection_day TEXT NOT NULL DEFAULT 'sunday';