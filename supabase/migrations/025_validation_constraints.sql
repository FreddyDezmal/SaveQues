-- ─────────────────────────────────────────────────────────────────────────────
-- 025_validation_constraints.sql
-- Hardening Sprint — Part 2: Validation & Sanitization
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHY
--   Several user-controlled text fields have no length cap and no enum
--   enforcement at the database level. API-level checks are added alongside
--   this migration (see route changes), but the DB constraint is the final
--   backstop — it also catches the case where a client (like
--   app/(app)/goals/new/page.tsx) writes directly via the Supabase client
--   library rather than through a server route.
--
-- VALUES USED
--   category    — taken from lib/utils.ts GOAL_CATEGORIES (12 valid ids)
--   currency_code — taken from lib/currency.ts SUPPORTED_CURRENCIES (10 codes)
--   goal_emoji  — NOT constrained to the GOAL_EMOJIS allowlist at the DB
--                 level. That list is a UI affordance (30 curated emoji) and
--                 is expected to grow; hardcoding it into a CHECK constraint
--                 would require a migration every time a new emoji option is
--                 added to lib/utils.ts. Instead we cap goal_emoji to a
--                 reasonable byte length (any single emoji, including
--                 multi-codepoint ones like 🏋️, fits well under 16 bytes).
--                 The allowlist IS enforced at the API level in
--                 PATCH /api/goal/edit (see route changes).
--
-- SAFETY
--   Every ALTER TABLE is preceded by a DO block that checks for existing
--   violating rows and raises an informative exception rather than failing
--   the constraint silently or corrupting data.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── transactions.amount — upper bound ──────────────────────────────────────────

DO $$
DECLARE bad_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO bad_count FROM public.transactions
  WHERE amount <= 0 OR amount > 10000000;

  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add transactions_amount_range_check: % row(s) have amount <= 0 or > 10,000,000. Review before re-running.',
      bad_count;
  END IF;
END $$;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_amount_range_check
  CHECK (amount > 0 AND amount <= 10000000);

-- ── transactions.note — length cap ────────────────────────────────────────────

DO $$
DECLARE bad_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO bad_count FROM public.transactions
  WHERE note IS NOT NULL AND length(note) > 500;

  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add transactions_note_length_check: % row(s) have note longer than 500 chars. Review before re-running.',
      bad_count;
  END IF;
END $$;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_note_length_check
  CHECK (note IS NULL OR length(note) <= 500);

-- ── savings_goals.title — length bounds ───────────────────────────────────────

DO $$
DECLARE bad_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO bad_count FROM public.savings_goals
  WHERE length(title) < 1 OR length(title) > 80;

  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add savings_goals_title_length_check: % row(s) have title outside 1-80 chars. Review before re-running.',
      bad_count;
  END IF;
END $$;

ALTER TABLE public.savings_goals
  ADD CONSTRAINT savings_goals_title_length_check
  CHECK (length(title) >= 1 AND length(title) <= 80);

-- ── savings_goals.category — enum enforcement ─────────────────────────────────
-- Mirrors lib/utils.ts GOAL_CATEGORIES exactly. If a new category is added
-- to that file, this constraint must be updated in a follow-up migration.

DO $$
DECLARE bad_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO bad_count FROM public.savings_goals
  WHERE category NOT IN (
    'emergency', 'travel', 'gadget', 'tuition', 'home', 'vehicle',
    'fashion', 'health', 'food', 'event', 'gift', 'custom'
  );

  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add savings_goals_category_check: % row(s) have a category outside the allowed set. Review before re-running.',
      bad_count;
  END IF;
END $$;

ALTER TABLE public.savings_goals
  ADD CONSTRAINT savings_goals_category_check
  CHECK (category IN (
    'emergency', 'travel', 'gadget', 'tuition', 'home', 'vehicle',
    'fashion', 'health', 'food', 'event', 'gift', 'custom'
  ));

-- ── savings_goals.goal_emoji — length cap (not allowlist; see header note) ────

ALTER TABLE public.savings_goals
  ADD CONSTRAINT savings_goals_goal_emoji_length_check
  CHECK (length(goal_emoji) <= 16);

-- ── profiles.display_name — length bounds ─────────────────────────────────────

DO $$
DECLARE bad_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO bad_count FROM public.profiles
  WHERE length(display_name) < 1 OR length(display_name) > 60;

  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add profiles_display_name_length_check: % row(s) have display_name outside 1-60 chars. Review before re-running.',
      bad_count;
  END IF;
END $$;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_display_name_length_check
  CHECK (length(display_name) >= 1 AND length(display_name) <= 60);

-- ── profiles.currency_code — enum enforcement ─────────────────────────────────
-- Mirrors lib/currency.ts SUPPORTED_CURRENCIES exactly. If a new currency is
-- added to that file, this constraint must be updated in a follow-up migration.

DO $$
DECLARE bad_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO bad_count FROM public.profiles
  WHERE currency_code NOT IN (
    'ZAR', 'USD', 'GBP', 'EUR', 'KES', 'NGN', 'GHS', 'AUD', 'CAD', 'INR'
  );

  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add profiles_currency_code_check: % row(s) have a currency_code outside the supported set. Review before re-running.',
      bad_count;
  END IF;
END $$;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_currency_code_check
  CHECK (currency_code IN (
    'ZAR', 'USD', 'GBP', 'EUR', 'KES', 'NGN', 'GHS', 'AUD', 'CAD', 'INR'
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification queries (run manually after migration):
--
-- SELECT conname FROM pg_constraint
-- WHERE conrelid IN (
--   'public.transactions'::regclass,
--   'public.savings_goals'::regclass,
--   'public.profiles'::regclass
-- ) AND contype = 'c'
-- ORDER BY conname;
-- ─────────────────────────────────────────────────────────────────────────────