import { NextRequest, NextResponse } from "next/server";
import { runDailyNotificationScheduler } from "@/lib/notifications";

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
    console.error("[cron/notifications] CRITICAL: CRON_SECRET environment variable is not set. Refusing to run.");
    return NextResponse.json(
      { error: "Cron endpoint is misconfigured. CRON_SECRET is not set." },
      { status: 500 }
    );
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log("[cron/notifications] Starting scheduler run…");
    const result = await runDailyNotificationScheduler();
    console.log("[cron/notifications] Done:", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("[cron/notifications] Error:", err);
    return NextResponse.json({ error: err.message ?? "Scheduler failed" }, { status: 500 });
  }
}

export { GET as POST };