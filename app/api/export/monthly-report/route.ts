/**
 * app/api/export/monthly-report/route.ts
 *
 * GET /api/export/monthly-report?format=csv
 *
 * Always "this month" — see lib/exportCenter.ts's monthlyReportGoalsToCSV
 * comment for why there is no ?month= parameter the way annual-report has
 * ?year=: buildMonthlyReport() computes goal health/pace against today's
 * real balances, so it can only honestly describe the current month.
 *
 * format=json (default) is not actually consumed by
 * app/(app)/reports/monthly/page.tsx (that page calls buildMonthlyReport()
 * directly server-side, same as annual/page.tsx does for the annual
 * report) — it exists for API consumers/future integrations, mirroring
 * annual-report's route shape. format=csv is the goal-by-goal health/pace
 * breakdown and is what actually consumes an export_limit unit.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkAttemptRateLimit, recordAttempt } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";
import { buildMonthlyReport } from "@/lib/monthlyReport";
import { formatCurrency } from "@/lib/utils";
import { monthlyReportGoalsToCSV } from "@/lib/exportCenter";
import { enforceUsageLimit, recordUsage } from "@/lib/billing/gate";
import type { SavingsGoal, Transaction } from "@/lib/types";

const log = createLogger("export.monthly-report");
const RATE_LIMIT_ENDPOINT = "export.monthly-report";

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const format = new URL(req.url).searchParams.get("format") === "csv" ? "csv" : "json";

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

  const [
    { data: profileData, error: profileError },
    { data: goalData, error: goalError },
    { data: txData, error: txError },
    { data: achievementData, error: achievementError },
    { data: activityData, error: activityError },
  ] = await Promise.all([
    supabase.from("profiles").select("streak_days, longest_streak, currency_code, locale").eq("id", user.id).single(),
    supabase
      .from("savings_goals")
      .select("id, user_id, title, target_amount, current_amount, target_date, is_complete")
      .eq("user_id", user.id),
    supabase
      .from("transactions")
      .select("id, user_id, goal_id, amount, note, transaction_type, created_at")
      .eq("user_id", user.id),
    supabase.from("user_achievements").select("achievement_id, earned_at").eq("user_id", user.id),
    supabase.from("activity_log").select("activity_date, xp_earned").eq("user_id", user.id),
  ]);

  if (profileError || goalError || txError || achievementError || activityError) {
    log.error("export.monthly-report failed", {
      user_id: user.id,
      error: (profileError ?? goalError ?? txError ?? achievementError ?? activityError)?.message,
    });
    return NextResponse.json({ error: "Couldn't build that report right now." }, { status: 500 });
  }

  const goals = (goalData ?? []) as SavingsGoal[];
  const report = buildMonthlyReport({
    transactions: (txData ?? []) as Transaction[],
    goals,
    achievements: achievementData ?? [],
    activityLog: (activityData ?? []).map((a: any) => ({ date: a.activity_date, xp_earned: a.xp_earned })),
    profile: { streak_days: profileData?.streak_days ?? 0, longest_streak: profileData?.longest_streak ?? 0 },
    formatAmount: (n) => formatCurrency(n, profileData?.currency_code ?? "ZAR", profileData?.locale ?? "en-ZA"),
  });

  if (format === "json") {
    return NextResponse.json({ report }, { headers: { "Cache-Control": "private, no-store" } });
  }

  // Same "only the download consumes a unit, viewing on-screen doesn't"
  // rule as export/annual-report/route.ts.
  const { blocked } = await enforceUsageLimit(user.id, "exports_limit", "monthly export");
  if (blocked) return blocked;

  const csv = monthlyReportGoalsToCSV(report, goals);
  await recordUsage(user.id, "exports_limit");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="savequest-monthly-report-${report.monthKey}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
