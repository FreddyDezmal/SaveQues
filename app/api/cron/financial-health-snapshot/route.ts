/**
 * app/api/cron/financial-health-snapshot/route.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 28 — Phase 5/11: Financial Health Score — daily snapshot cron.
 *
 * Same CRON_SECRET fail-closed pattern as every other cron route in this
 * codebase (see app/api/cron/notifications/route.ts's docstring for the
 * full rationale — not repeated here).
 *
 * Schedule: once daily (see vercel.json), after the notifications cron so
 * any deposits/goal changes that trigger same-day notifications are
 * already reflected before today's score is snapshotted. Exact time
 * offset isn't load-bearing — a snapshot a few hours later in the day
 * changes nothing about correctness, only which intra-day state gets
 * captured.
 */

import { NextRequest, NextResponse } from "next/server";
import { runFinancialHealthSnapshotScheduler } from "@/lib/financialHealthSnapshot";
import { createLogger } from "@/lib/logger";
import { captureError } from "@/lib/monitoring";

const log = createLogger("cron.financial-health-snapshot");

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    log.error("CRON_SECRET environment variable is not set — refusing to run", { action: "config_check" });
    return NextResponse.json({ error: "Cron endpoint is misconfigured. CRON_SECRET is not set." }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    log.warn("Unauthorised cron request", { action: "auth_check" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runFinancialHealthSnapshotScheduler();
    log.info("Financial health snapshot run complete", { ...result });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Financial health snapshot run failed", { error: message });
    captureError(err, { action: "financial_health_snapshot_cron" });
    return NextResponse.json({ error: "Snapshot run failed" }, { status: 500 });
  }
}
