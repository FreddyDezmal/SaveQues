/**
 * app/api/cron/exchange-rates/route.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 31 — Phase 6: daily exchange rate cache refresh.
 *
 * Same CRON_SECRET fail-closed pattern as every other cron route in this
 * codebase (see app/api/cron/notifications/route.ts's docstring for the
 * full rationale — not repeated here).
 *
 * Schedule: once daily (see vercel.json). Exact time of day isn't load
 * bearing — see lib/exchangeRates/cache.ts's file header for the 24h TTL
 * this keeps warm, and its documented fallback order for what happens on
 * a day this cron fails to run (getCachedRate() self-heals reactively).
 */

import { NextRequest, NextResponse } from "next/server";
import { refreshAllRates } from "@/lib/exchangeRates/cache";
import { createLogger } from "@/lib/logger";
import { captureError } from "@/lib/monitoring";

const log = createLogger("cron.exchange-rates");

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
    const rates = await refreshAllRates();
    log.info("Exchange rate refresh run complete", { count: rates.length });
    return NextResponse.json({ ok: true, count: rates.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Exchange rate refresh run failed", { error: message });
    captureError(err, { action: "exchange_rates_cron" });
    return NextResponse.json({ error: "Refresh run failed" }, { status: 500 });
  }
}
