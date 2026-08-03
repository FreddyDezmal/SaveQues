/**
 * app/(app)/reports/monthly/page.tsx
 * ─────────────────────────────────────────────────────────────
 * Sprint 30 — Phase 5: Premium Reports — Monthly Financial Report.
 *
 * buildMonthlyReport() (lib/monthlyReport.ts) already existed (Sprint
 * 20) but had zero page/export surface before this sprint (see the
 * Phase 1 audit and lib/exportCenter.ts's monthlyReportGoalsToCSV
 * comment). Mirrors app/(app)/reports/annual/page.tsx's fetch pattern
 * exactly (parallel Promise.all, direct lib call, no extra HTTP
 * round-trip) — deliberately does NOT add a ?month= picker the way the
 * annual report has ?year=, because buildMonthlyReport() is only
 * accurate for the current month (see that file's own header).
 */

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { buildMonthlyReport } from "@/lib/monthlyReport";
import { formatCurrency } from "@/lib/utils";
import MonthlyReportClient from "./MonthlyReportClient";
import type { SavingsGoal, Transaction } from "@/lib/types";

export default async function MonthlyReportPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [profileRes, goalsRes, txRes, achievementsRes, activityRes] = await Promise.all([
    supabase.from("profiles").select("streak_days, longest_streak, currency_code, locale").eq("id", user.id).single(),
    supabase
      .from("savings_goals")
      .select("id, user_id, title, category, goal_emoji, target_amount, current_amount, target_date, is_complete")
      .eq("user_id", user.id),
    supabase
      .from("transactions")
      .select("id, user_id, goal_id, amount, note, transaction_type, created_at")
      .eq("user_id", user.id),
    supabase.from("user_achievements").select("achievement_id, earned_at").eq("user_id", user.id),
    supabase.from("activity_log").select("activity_date, xp_earned").eq("user_id", user.id),
  ]);

  const profile = profileRes.data ?? { streak_days: 0, longest_streak: 0, currency_code: "ZAR", locale: "en-ZA" };
  const goals = (goalsRes.data ?? []) as SavingsGoal[];
  const transactions = (txRes.data ?? []) as Transaction[];

  const report = buildMonthlyReport({
    transactions,
    goals,
    achievements: achievementsRes.data ?? [],
    activityLog: (activityRes.data ?? []).map((a: any) => ({ date: a.activity_date, xp_earned: a.xp_earned })),
    profile: { streak_days: profile.streak_days ?? 0, longest_streak: profile.longest_streak ?? 0 },
    formatAmount: (n) => formatCurrency(n, profile.currency_code ?? "ZAR", profile.locale ?? "en-ZA"),
  });

  return (
    <MonthlyReportClient
      report={report}
      goals={goals}
      currencyCode={profile.currency_code ?? "ZAR"}
      locale={profile.locale ?? "en-ZA"}
    />
  );
}
