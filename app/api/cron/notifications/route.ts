import { NextRequest, NextResponse } from "next/server";
import { runDailyNotificationScheduler, runWeeklySummaryScheduler, runPartnerReminderScheduler, runGroupWeeklySummaryScheduler, runGroupQuestEndingReminderScheduler, runMonthlyDigestScheduler, runNotificationLogsCleanupScheduler } from "@/lib/notifications";
import { checkNotificationDeliveryRate } from "@/lib/businessMetrics";
import { createLogger } from "@/lib/logger";
import { captureError, setSentryUser } from "@/lib/monitoring";

const log = createLogger("cron.notifications");

/**
 * GET /api/cron/notifications
 *
 * Called ONCE DAILY by Vercel Cron (see vercel.json: "0 8 * * *", 08:00 UTC).
 *
 * IMPORTANT — this docstring previously said "called every hour," which was
 * stale and incorrect (confirmed during Sprint 11 Phase 1 investigation).
 * The cron has always been once-daily; runDailyNotificationScheduler() in
 * lib/notifications.ts was rewritten in migration 017 specifically to work
 * correctly under a single daily invocation — it tracks
 * last_notification_sent_date per user and guarantees at least one
 * notification per user per day via an "overdue" fallback, rather than
 * requiring an exact hourly match against the user's preferred hour. See
 * lib/notifications.ts for the full mechanism.
 *
 * Protected by CRON_SECRET.
 *
 * M5 Security fix:
 *   Previous logic: `if (secret && authHeader !== expected)`
 *   This fails OPEN when CRON_SECRET is not set — any unauthenticated
 *   request would bypass the check and execute the scheduler.
 *
 *   New logic: if CRON_SECRET is missing from env, the route returns 500
 *   and logs a configuration error. It never executes cron logic without
 *   a configured secret. Misconfigured environments fail closed.
 *
 * Sprint 11 — Phase 4 addition: business-outcome metrics. A successful
 * HTTP 200 from this route does NOT mean notifications were actually
 * delivered to a healthy fraction of eligible users — it only means the
 * scheduler ran without throwing. See lib/businessMetrics.ts for the
 * notification delivery rate check that catches the case this route's
 * own error handling structurally cannot: a process that completes
 * successfully but produces a bad business outcome.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;

  // M5 fix: fail closed — a missing secret is a misconfiguration, not a pass
  if (!secret) {
    log.error("CRON_SECRET environment variable is not set — refusing to run", {
      action: "config_check",
    });
    return NextResponse.json(
      { error: "Cron endpoint is misconfigured. CRON_SECRET is not set." },
      { status: 500 }
    );
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    log.warn("Unauthorised cron request", { action: "auth_check" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runId = crypto.randomUUID().slice(0, 8);
  const end = log.time("scheduler run", { run_id: runId });

  try {
    const result = await runDailyNotificationScheduler();
    end({
      run_id:          runId,
      notifications_sent:    (result as any).sent    ?? 0,
      notifications_skipped: (result as any).skipped ?? 0,
      errors:                (result as any).errors  ?? 0,
    });

    // Sprint 17: weekly savings recap. Deliberately piggybacks on this
    // same once-daily cron invocation rather than adding a second Vercel
    // Cron entry — Vercel's free/hobby tier caps the number of cron jobs
    // per project, and a day-of-week gate here costs nothing extra to run
    // (the function no-ops immediately most days). Wrapped in its own
    // try/catch, same reasoning as checkNotificationDeliveryRate below: a
    // failure in the weekly summary must never fail the daily scheduler's
    // own (already-successful) run.
    if (new Date().getUTCDay() === 1 /* Monday */) {
      try {
        const weeklyResult = await runWeeklySummaryScheduler();
        log.info("Weekly summary run complete", { run_id: runId, ...weeklyResult });
      } catch (weeklyErr: any) {
        log.warn("Weekly summary run failed (non-fatal to daily scheduler)", {
          run_id: runId, error: weeklyErr.message ?? String(weeklyErr),
        });
      }
    }

    // Sprint 22, Phase 11: quiet-partnership reminders. Runs on every
    // invocation (not gated to Monday) — see runPartnerReminderScheduler's
    // own doc comment for why a partnership going quiet is worth catching
    // sooner than a week later. Own try/catch, same reasoning as every
    // other piggybacked job on this cron: a failure here must never fail
    // the (already-successful) daily scheduler run.
    try {
      const partnerResult = await runPartnerReminderScheduler();
      log.info("Partner reminder run complete", { run_id: runId, ...partnerResult });
    } catch (partnerErr: any) {
      log.warn("Partner reminder run failed (non-fatal to daily scheduler)", {
        run_id: runId, error: partnerErr.message ?? String(partnerErr),
      });
    }

    // Sprint 22, Phase 11: group weekly digest. Same Monday gate and same
    // "reuse the existing cron slot" reasoning as the personal weekly
    // summary above.
    if (new Date().getUTCDay() === 1 /* Monday */) {
      try {
        const groupWeeklyResult = await runGroupWeeklySummaryScheduler();
        log.info("Group weekly summary run complete", { run_id: runId, ...groupWeeklyResult });
      } catch (groupWeeklyErr: any) {
        log.warn("Group weekly summary run failed (non-fatal to daily scheduler)", {
          run_id: runId, error: groupWeeklyErr.message ?? String(groupWeeklyErr),
        });
      }
    }

    // Sprint 27, Phase 3: group quest ending soon. Runs on every
    // invocation (not gated to Monday) — a group quest's 2-day-out
    // deadline can land on any day of the week, unlike the weekly/monthly
    // digests above. Own try/catch, same non-fatal reasoning as every
    // other piggybacked job on this cron.
    try {
      const groupQuestEndingResult = await runGroupQuestEndingReminderScheduler();
      log.info("Group quest ending reminder run complete", { run_id: runId, ...groupQuestEndingResult });
    } catch (groupQuestEndingErr: any) {
      log.warn("Group quest ending reminder run failed (non-fatal to daily scheduler)", {
        run_id: runId, error: groupQuestEndingErr.message ?? String(groupQuestEndingErr),
      });
    }

    // Sprint 27, Phase 5: monthly digest. Gated to the 1st of the calendar
    // month, same "no new Vercel Cron slot, no-op most days" reasoning as
    // the Monday-gated weekly jobs above.
    if (new Date().getUTCDate() === 1) {
      try {
        const monthlyResult = await runMonthlyDigestScheduler();
        log.info("Monthly digest run complete", { run_id: runId, ...monthlyResult });
      } catch (monthlyErr: any) {
        log.warn("Monthly digest run failed (non-fatal to daily scheduler)", {
          run_id: runId, error: monthlyErr.message ?? String(monthlyErr),
        });
      }
    }

    // Sprint 27, Phase 13: notification_logs retention cleanup. Gated to
    // Sundays — housekeeping, not time-sensitive, and a DELETE across a
    // potentially large table doesn't need to run daily.
    if (new Date().getUTCDay() === 0) {
      try {
        const cleanupResult = await runNotificationLogsCleanupScheduler();
        log.info("Notification logs cleanup run complete", { run_id: runId, ...cleanupResult });
      } catch (cleanupErr: any) {
        log.warn("Notification logs cleanup run failed (non-fatal to daily scheduler)", {
          run_id: runId, error: cleanupErr.message ?? String(cleanupErr),
        });
      }
    }

    // Sprint 11 — Phase 4: evaluate whether today's run actually reached a
    // healthy fraction of eligible users. This is the check that would
    // have caught both the original audit's (incorrect) concern and the
    // real record_app_open() timezone bug found during Phase 1 — neither
    // produces an exception, so neither would ever surface without a
    // business-outcome check like this one. Failure to run this check
    // must never fail the cron itself — it's wrapped separately.
    try {
      await checkNotificationDeliveryRate();
    } catch (metricErr: any) {
      log.warn("Notification delivery rate check failed (non-fatal)", {
        run_id: runId, error: metricErr.message ?? String(metricErr),
      });
    }

    return NextResponse.json({ ok: true, run_id: runId, ...result });
  } catch (err: any) {
    const duration_ms = 0; // end() won't be called — log manually
    log.error("Scheduler run failed", {
      run_id:     runId,
      error:      err.message ?? String(err),
    });
    captureError(err, { route: "GET /api/cron/notifications", run_id: runId });
    return NextResponse.json({ error: err.message ?? "Scheduler failed" }, { status: 500 });
  }
}

export { GET as POST };