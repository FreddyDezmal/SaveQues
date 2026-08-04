/**
 * app/api/export/annual-report/route.ts
 *
 * GET /api/export/annual-report?year=2026&format=json|csv&section=monthly|category|milestones
 *
 *   format=json (default) — the full AnnualReport object, consumed by
 *     app/(app)/reports/annual/page.tsx (the print-ready "PDF" view —
 *     see lib/exportCenter.ts's header for why there's no server-generated
 *     binary PDF yet).
 *   format=csv — one of three flattened tables, chosen by `section`
 *     (default "monthly"): month-by-month totals, category totals, or
 *     the year's milestones.
 *
 * `year` defaults to the current UTC year. Deliberately no restriction
 * on which past years can be requested — a user's own full history is
 * theirs to export.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkAttemptRateLimit, recordAttempt } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";
import {
  buildAnnualReport,
  annualReportMonthlyToCSV,
  annualReportCategoryToCSV,
  milestonesToCSV,
} from "@/lib/exportCenter";
import { enforceUsageLimit, recordUsage } from "@/lib/billing/gate";
import type { SavingsGoal, Transaction } from "@/lib/types";

const log = createLogger("export.annual-report");
const RATE_LIMIT_ENDPOINT = "export.annual-report";

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const yearParam = url.searchParams.get("year");
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getUTCFullYear();
  const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
  const section = url.searchParams.get("section") ?? "monthly";

  if (!Number.isInteger(year) || year < 2000 || year > 3000) {
    return NextResponse.json({ error: "Invalid year" }, { status: 400 });
  }

  const limit = await checkAttemptRateLimit(supabase, {
    userId: user.id,
    endpoint: RATE_LIMIT_ENDPOINT,
    windowMinutes: 60,
    maxRequests: 20,
    actionLabel: "exports",
  });
  await recordAttempt(supabase, user.id, RATE_LIMIT_ENDPOINT);
  if (!limit.allowed) {
    return NextResponse.json({ error: limit.message }, { status: 429 });
  }

  const [{ data: profileData, error: profileError }, { data: goalData, error: goalError }, { data: txData, error: txError }] =
    await Promise.all([
      supabase.from("profiles").select("created_at, xp_total, currency_code, locale").eq("id", user.id).single(),
      supabase
        .from("savings_goals")
        .select("id, user_id, title, category, goal_emoji, target_amount, current_amount, target_date, is_complete, created_at")
        .eq("user_id", user.id),
      supabase
        .from("transactions")
        .select("id, user_id, goal_id, amount, note, transaction_type, created_at")
        .eq("user_id", user.id),
    ]);

  if (profileError || goalError || txError) {
    log.error("export.annual-report failed", {
      user_id: user.id,
      error: (profileError ?? goalError ?? txError)?.message,
    });
    return NextResponse.json({ error: "Couldn't build that report right now." }, { status: 500 });
  }

  const report = buildAnnualReport({
    profile: profileData!,
    goals: (goalData ?? []) as SavingsGoal[],
    transactions: (txData ?? []) as Transaction[],
    year,
  });

  if (format === "json") {
    return NextResponse.json({ report }, { headers: { "Cache-Control": "private, no-store" } });
  }

  // Sprint 29 — Premium Subscription Platform, Phase 5: only the CSV
  // download consumes an export unit. format=json powers
  // app/(app)/reports/annual/page.tsx's on-screen view (and its
  // print-to-PDF flow) — viewing your own report isn't "an export" in
  // the sense the Free-tier limit is meant to cover; downloading a CSV
  // file is.
  const { blocked } = await enforceUsageLimit(user.id, "exports_limit", "monthly export");
  if (blocked) return blocked;

  const csv =
    section === "category" ? annualReportCategoryToCSV(report, profileData?.currency_code ?? "ZAR") :
    section === "milestones" ? milestonesToCSV(report.milestones) :
    annualReportMonthlyToCSV(report, profileData?.currency_code ?? "ZAR");

  await recordUsage(user.id, "exports_limit");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="savequest-annual-report-${year}-${section}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
