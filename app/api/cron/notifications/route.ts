import { NextRequest, NextResponse } from "next/server";
import { runDailyNotificationScheduler } from "@/lib/notifications";
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