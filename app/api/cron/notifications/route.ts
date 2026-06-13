import { NextRequest, NextResponse } from "next/server";
import { runDailyNotificationScheduler } from "@/lib/notifications";

/**
 * GET /api/cron/notifications
 *
 * Called every hour by your cron service (Supabase cron / GitHub Actions / etc.).
 * Protected by CRON_SECRET to prevent unauthorised triggering.
 *
 * Example cron (runs every hour):
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://yourapp.com/api/cron/notifications
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const secret     = process.env.CRON_SECRET;

  if (secret && authHeader !== `Bearer ${secret}`) {
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

// Also allow POST for easier webhook integration
export { GET as POST };
