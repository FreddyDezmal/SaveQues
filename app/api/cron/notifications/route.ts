import { NextRequest, NextResponse } from "next/server";
import { runDailyNotificationScheduler } from "@/lib/notifications";
import { createLogger } from "@/lib/logger";
import { captureError, setSentryUser } from "@/lib/monitoring";

const log = createLogger("cron.notifications");

/**
 * GET /api/cron/notifications
 *
 * Called every hour by the cron service.
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