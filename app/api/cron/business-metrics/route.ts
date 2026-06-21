/**
 * app/api/cron/business-metrics/route.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 11 — Phase 4: Business Outcome Monitoring
 *
 * Runs all four business-outcome checks (notification delivery rate,
 * deposit/withdrawal/quest success rates) on a schedule, independent of
 * any single user request. Alerts (via Sentry, the only alerting channel
 * confirmed to exist in this codebase during Phase 1) are raised inside
 * lib/businessMetrics.ts itself when a threshold is breached — this route
 * is just the scheduled trigger.
 *
 * Protected by CRON_SECRET, same fail-closed pattern as
 * /api/cron/notifications (see that route for the full rationale).
 *
 * Schedule: every 6 hours (see vercel.json) — frequent enough to catch a
 * regression within the same business day, infrequent enough that four
 * lightweight read queries are not a meaningful load concern.
 */

import { NextRequest, NextResponse } from "next/server";
import { runAllBusinessMetricChecks } from "@/lib/businessMetrics";
import { createLogger } from "@/lib/logger";
import { captureError } from "@/lib/monitoring";

const log = createLogger("cron.business-metrics");

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;

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
  const end = log.time("business metrics run", { run_id: runId });

  try {
    const result = await runAllBusinessMetricChecks();
    end({
      run_id: runId,
      notification_rate: result.notifications.deliveryRate ?? -1,
      deposit_rate:       result.deposits.successRate ?? -1,
      withdrawal_rate:    result.withdrawals.successRate ?? -1,
      quest_rate:         result.quests.successRate ?? -1,
      any_alerted: result.notifications.alerted || result.deposits.alerted
                || result.withdrawals.alerted || result.quests.alerted,
    });
    return NextResponse.json({ ok: true, run_id: runId, ...result });
  } catch (err: any) {
    log.error("Business metrics run failed", { run_id: runId, error: err.message ?? String(err) });
    captureError(err, { route: "GET /api/cron/business-metrics", run_id: runId });
    return NextResponse.json({ error: err.message ?? "Business metrics check failed" }, { status: 500 });
  }
}

export { GET as POST };