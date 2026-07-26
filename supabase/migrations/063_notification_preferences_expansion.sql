-- ─────────────────────────────────────────────────────────────────────────────
-- Sprint 27, Phase 4 — Notification Preferences expansion
--
-- Extends the existing notification_preferences table (039, Sprint 16)
-- rather than replacing it — every existing column, RLS policy, and the
-- updated_at trigger are untouched. New columns only.
--
-- HONESTY NOTE (same pattern as 039's own note — kept up to date rather
-- than left to drift):
--
--   Categories added this phase:
--     • groups   → LIVE. Gates group_invite, goal_invitation, and the new
--                  group_quest_ending (Sprint 27 Phase 3). group_quest_completed
--                  and group_weekly_summary already existed and reuse
--                  milestone_celebrations / weekly_summaries respectively —
--                  left as-is, not moved onto this new column, to avoid
--                  silently changing behavior for a toggle users may have
--                  already set.
--     • partners → LIVE. Gates partner_request, partner_accepted,
--                  partner_nudge, partner_reminder — all four previously had
--                  NO dedicated category (global notifications_enabled switch
--                  only), exactly the gap 22's and 27 Phase 3's own comments
--                  already flagged as "Phase 11/future scope." This is that
--                  future scope, arriving in Phase 4 instead because that's
--                  where the sprint brief put "Partners" as a category.
--     • xp               → NOT LIVE. No notification type exists for a bare
--                           XP gain distinct from achievement_unlocked —
--                           XP-worthy events already notify via that type.
--                           Column is real and persisted; nothing reads it yet.
--     • referrals        → NOT LIVE. No referral feature exists anywhere in
--                           this codebase (confirmed by full-repo grep during
--                           the Phase 1 audit) — there is no referral_joined
--                           notification type, no referral send path, nothing
--                           to gate. Column persisted for when that feature
--                           is eventually built.
--     • monthly_summaries → NOT LIVE. Monthly digest generation is Sprint 27
--                           Phase 5 scope (not yet built). Column persisted.
--
--   friend_request / friend_accepted are NOT moved onto "groups" or
--   "partners" — "Social/Friends" isn't one of the categories this phase's
--   brief lists (Goals, Groups, Partners, Achievements, XP, Referrals,
--   Marketing, Weekly/Monthly summaries), so no dedicated toggle was
--   invented for it. They remain gated by the global switch only, same as
--   before this migration.
--
--   "Marketing" (brief's wording) is the EXISTING product_announcements
--   column, relabeled in the UI only — not a new column, not a rename, to
--   avoid an unnecessary migration for a cosmetic label change.
--
--   Quiet hours and vacation mode ARE fully live and enforced this phase
--   (lib/notifications.ts) — see the code comments at their call sites for
--   exactly what they suppress and the one honest limitation each carries
--   (documented in docs/SPRINT27_PHASE4_NOTIFICATION_PREFERENCES.md).
--
--   Digest frequency ('immediate' | 'hourly' | 'daily' | 'weekly') is
--   persisted and selectable in the UI, but ONLY 'immediate' changes
--   behavior today. This app's cron runs at most once daily (Vercel
--   Hobby tier — see runDailyNotificationScheduler's own docstring), so
--   'hourly' cannot be honestly enforced without different infra, and
--   digest BATCHING/generation (turning many events into one email/push)
--   is explicitly Sprint 27 Phase 5 scope, not built yet. Choosing
--   'hourly'/'daily'/'weekly' today does not currently change what a user
--   receives — the UI says so explicitly, same "Coming soon" pattern as
--   xp/referrals/monthly_summaries above, rather than silently accepting a
--   preference this app cannot yet honor.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS groups                boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS partners              boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS xp                    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS referrals             boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS monthly_summaries     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS quiet_hours_enabled   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quiet_hours_start     smallint NOT NULL DEFAULT 22,
  ADD COLUMN IF NOT EXISTS quiet_hours_end       smallint NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS vacation_mode         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vacation_until        date,
  ADD COLUMN IF NOT EXISTS digest_frequency      text NOT NULL DEFAULT 'immediate';

-- Guard rails on the two new "shape" columns — same defensive style as the
-- existing goal_status / quest_type CHECK constraints elsewhere in this
-- schema (014, 045). Added as separate ALTERs (not inline on the ADD
-- COLUMN above) so this migration stays re-runnable: a second run's
-- ADD COLUMN IF NOT EXISTS is a no-op, but re-adding an inline CHECK
-- would error on Postgres versions that don't support IF NOT EXISTS on
-- constraints.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notification_preferences_quiet_hours_range'
  ) THEN
    ALTER TABLE notification_preferences
      ADD CONSTRAINT notification_preferences_quiet_hours_range
      CHECK (quiet_hours_start BETWEEN 0 AND 23 AND quiet_hours_end BETWEEN 0 AND 23);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notification_preferences_digest_frequency_check'
  ) THEN
    ALTER TABLE notification_preferences
      ADD CONSTRAINT notification_preferences_digest_frequency_check
      CHECK (digest_frequency IN ('immediate', 'hourly', 'daily', 'weekly'));
  END IF;
END $$;

-- No RLS policy changes needed — the existing "own row only" SELECT/INSERT/
-- UPDATE policies from 039 apply to the whole row, new columns included.
