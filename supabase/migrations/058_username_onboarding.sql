-- ─────────────────────────────────────────────────────────────────────────────
-- 058_username_onboarding.sql
--
-- profiles.username already existed as a nullable, case-insensitively-unique
-- column (045_social_foundation.sql) — that migration's own comment says
-- explicitly: "backfill/enforcement of NOT NULL is an app-layer onboarding
-- step, not this migration's job." This migration is that step: existing
-- users (who signed up before username existed, or before this rollout)
-- get one backfilled automatically; new signups choose their own via the
-- app. No new table — extends the existing column, per house style.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- PART A — Format rule
-- ═══════════════════════════════════════════════════════════════════════════
-- 3-20 chars, ASCII letters/digits/underscore only. Deliberately NOT
-- unicode/whitespace-permissive even though "usernames can be anything" was
-- the product ask — the actual goal stated alongside that ("easier to
-- search for them") needs a predictable, URL/typeahead-safe handle. Case is
-- preserved as typed (display) while the existing LOWER(username) unique
-- index (045) still governs uniqueness case-insensitively — unchanged here.
--
-- Backfill in PART C runs BEFORE this constraint is added, and is written to
-- always produce a conformant value, so this cannot fail against existing
-- data.
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_format
  CHECK (username IS NULL OR username ~ '^[A-Za-z0-9_]{3,20}$');

-- ═══════════════════════════════════════════════════════════════════════════
-- PART B — Availability check, callable before an account exists
-- ═══════════════════════════════════════════════════════════════════════════
-- profiles SELECT is locked to `auth.uid() = id` (014) — a signed-out
-- visitor mid-signup, or a signed-in user checking a NEW handle, can't read
-- other rows directly. This RPC exposes only the one boolean fact needed,
-- nothing else about the row (no id, no display_name — an availability
-- checker is not a lookup). SECURITY DEFINER, left with the default PUBLIC
-- EXECUTE grant (same pattern as get_invite_preview, 053, which is also
-- deliberately reachable before authentication) rather than an explicit
-- GRANT — no REVOKE is issued here, so both `anon` and `authenticated` can
-- call it.
CREATE OR REPLACE FUNCTION public.is_username_available(p_username TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_username IS NULL OR p_username !~ '^[A-Za-z0-9_]{3,20}$' THEN
    RETURN FALSE;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE LOWER(username) = LOWER(p_username)
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART C — Backfill existing users
-- ═══════════════════════════════════════════════════════════════════════════
-- One-time, idempotent (only ever touches username IS NULL rows, so a
-- second run of this migration — or a re-run of this file in a fresh
-- environment — has nothing left to do). Per the product decision: existing
-- users' username becomes a slug of their CURRENT display_name, so it reads
-- as "the same name" to them; collisions get a numeric suffix rather than
-- failing, since two users can easily share a display_name (e.g. the
-- "Saver" default) even though usernames must be unique.
DO $$
DECLARE
  r           RECORD;
  base_slug   TEXT;
  candidate   TEXT;
  suffix      INT;
BEGIN
  FOR r IN
    SELECT id, display_name FROM public.profiles WHERE username IS NULL
  LOOP
    -- Slugify: lowercase, strip everything outside [a-z0-9_], collapse
    -- repeats aren't necessary since we're deleting (not replacing with
    -- one) — matches profiles_username_format's allowed character set.
    base_slug := LOWER(REGEXP_REPLACE(COALESCE(r.display_name, ''), '[^A-Za-z0-9_]', '', 'g'));

    -- Empty after stripping (e.g. a display_name that was pure emoji), or
    -- too short for the 3-char minimum: fall back to a stable, always-valid
    -- base derived from the user's own id instead of a shared literal
    -- (falling back to a fixed string like "user" for everyone in this
    -- situation would just recreate the exact collision problem this loop
    -- exists to solve, at a larger scale, before it even starts resolving).
    IF LENGTH(base_slug) < 3 THEN
      base_slug := 'user_' || REPLACE(r.id::TEXT, '-', '');
    END IF;

    -- Respect the 20-char max up front so a numeric suffix always fits.
    base_slug := LEFT(base_slug, 16);

    candidate := base_slug;
    suffix := 1;
    WHILE EXISTS (SELECT 1 FROM public.profiles WHERE LOWER(username) = LOWER(candidate)) LOOP
      suffix := suffix + 1;
      candidate := LEFT(base_slug, 16 - LENGTH(suffix::TEXT) - 1) || '_' || suffix::TEXT;
    END LOOP;

    UPDATE public.profiles SET username = candidate WHERE id = r.id;
  END LOOP;
END $$;
