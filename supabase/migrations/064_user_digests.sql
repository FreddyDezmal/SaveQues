-- ─────────────────────────────────────────────────────────────────────────────
-- Sprint 27, Phase 5 — Digest System
--
-- New table, not a bolt-on to notification_logs — a digest is a distinct
-- artifact (a persisted snapshot the user can revisit) rather than a
-- notification event. The weekly_summary / monthly_summary notification
-- rows in notification_logs still exist as normal for the Notification
-- Center inbox (Phase 2) — they carry a short push-style highlight and a
-- deep link. This table holds the FULL breakdown that deep link resolves
-- to: everything the sprint brief's weekly/monthly examples list (saved
-- amount, quests completed, XP, level, streak, closest goal for weekly;
-- savings/XP graphs, achievements, best/worst week, momentum for monthly).
--
-- Persisted rather than recomputed on every view for two reasons: (1) a
-- digest should show what was true AT THE TIME it was generated, not
-- silently change if the user's data changes later (e.g. a goal gets
-- renamed, a deposit gets corrected) — recomputing on view would make
-- last week's digest lie about last week; (2) it avoids re-running the
-- same aggregation queries (activity_log scans, xp_awards sums) every
-- time a user opens an old digest from their history.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_digests (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  digest_type  text NOT NULL CHECK (digest_type IN ('weekly', 'monthly')),
  period_start date NOT NULL,
  period_end   date NOT NULL,
  -- Shape matches lib/digest.ts's WeeklyDigestData / MonthlyDigestData
  -- exactly (whichever applies for digest_type) — the API route and page
  -- that render this just JSON.parse the row and trust that shape rather
  -- than re-validating field-by-field, since only this codebase's own
  -- scheduler ever writes to this table (service-role only, no client
  -- INSERT policy below).
  payload      jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_digests ENABLE ROW LEVEL SECURITY;

-- Read-only from the client. Rows are written exclusively by
-- runWeeklySummaryScheduler() / runMonthlyDigestScheduler() via the
-- service-role client (lib/notifications.ts), which bypasses RLS —
-- deliberately no INSERT/UPDATE/DELETE policy for authenticated users,
-- same "server decides, client reads" shape as notification_logs.
CREATE POLICY "user_digests_select_own" ON public.user_digests
  FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_user_digests_user_type_period
  ON public.user_digests (user_id, digest_type, period_start DESC);
