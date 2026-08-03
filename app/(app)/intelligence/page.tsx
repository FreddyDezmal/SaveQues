// app/(app)/intelligence/page.tsx
//
// Sprint 30 — Phase 4: Intelligence Center.
//
// AUDIT NOTE (Sprint 30 Phase 1): this route did not exist before this
// sprint — every other page on this list (Financial Health, Cash Flow,
// Category Intelligence, AI Coach, etc.) already existed and was already
// wired into the dashboard. This page's only job is to give all of that
// one dedicated, full-detail surface — it computes nothing itself.
//
// Fetches the plain-select shape lib/intelligence/getFinancialIntelligence.ts
// documents as its contract (transactions/goals/activityLog/achievements/
// profile) — the same shape app/(app)/dashboard/page.tsx already builds,
// just via direct queries (like app/(app)/portfolio/page.tsx) rather than
// the dashboard's single consolidated RPC, since this page doesn't need
// that RPC's streak/XP/quest side-effects. getFinancialIntelligence() is
// called exactly once, and passed through to the client component as one
// bundle — no field is recomputed by hand here or in IntelligenceClient.

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getFinancialIntelligence } from "@/lib/intelligence/getFinancialIntelligence";
import { forecastGoal } from "@/lib/forecast";
import { computeGoalHealth } from "@/lib/goalHealth";
import { coachingMessagesForGoal } from "@/lib/coaching";
import IntelligenceClient from "./IntelligenceClient";
import type { Transaction, SavingsGoal } from "@/lib/types";

export default async function IntelligencePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [profileRes, goalsRes, txRes, achievementsRes, activityRes] = await Promise.all([
    supabase.from("profiles").select("streak_days, longest_streak, currency_code, locale").eq("id", user.id).single(),
    supabase.from("savings_goals").select("*").eq("user_id", user.id),
    supabase.from("transactions").select("id, user_id, goal_id, amount, note, transaction_type, created_at").eq("user_id", user.id).order("created_at", { ascending: false }),
    supabase.from("user_achievements").select("achievement_id, earned_at").eq("user_id", user.id),
    supabase.from("activity_log").select("activity_date, xp_earned, actions_count").eq("user_id", user.id),
  ]);

  const profile = profileRes.data ?? { streak_days: 0, longest_streak: 0, currency_code: "ZAR", locale: "en-ZA" };
  const goals = (goalsRes.data ?? []) as SavingsGoal[];
  const transactions = (txRes.data ?? []) as Transaction[];
  const achievements = achievementsRes.data ?? [];
  const activityLog = (activityRes.data ?? []).map((a: any) => ({
    date: a.activity_date,
    xp_earned: a.xp_earned,
    actions_count: a.actions_count,
  }));

  const hasDeposit = transactions.some((t) => t.transaction_type === "deposit");

  // Same "not enough history to bother" gate the dashboard uses — this
  // page doesn't invent a different threshold (see
  // getFinancialIntelligence()'s own docstring on why that gate lives with
  // callers, not the orchestrator itself).
  const intelligence = hasDeposit
    ? getFinancialIntelligence({
        transactions,
        goals,
        activityLog,
        achievements,
        profile: {
          streak_days: profile.streak_days ?? 0,
          longest_streak: profile.longest_streak ?? 0,
          currency_code: profile.currency_code,
          locale: profile.locale,
        },
      })
    : null;

  // ── "Top Priority Goal" ──────────────────────────────────────────────
  // Not a field getFinancialIntelligence() returns — no engine in this
  // codebase currently ranks EXISTING goals by priority (confirmed in the
  // Phase 1 audit: interventions/behaviorProfile are account-wide, not
  // per-goal; goalRecommendations suggests NEW goal categories, not a
  // ranking of current ones). Rather than invent a new ranking engine —
  // exactly what the brief says not to do — this surfaces the one
  // existing, real signal for "the goal this user has already told us
  // matters most": the `is_primary` flag already on savings_goals and
  // already used for reflection.ts's weekly summary. Falls back to the
  // active goal closest to its target date if no goal is marked primary.
  // Documented as a known limitation, not silently invented — see the
  // Phase 4 summary.
  const activeGoals = goals.filter((g) => !g.is_complete);
  const priorityGoal =
    activeGoals.find((g) => g.is_primary) ??
    [...activeGoals].sort((a, b) => {
      if (!a.target_date) return 1;
      if (!b.target_date) return -1;
      return a.target_date.localeCompare(b.target_date);
    })[0] ??
    null;

  // Reuses forecastGoal()/computeGoalHealth()/coachingMessagesForGoal()
  // exactly as GoalDetailClient.tsx already does for the single goal it's
  // showing — per-goal engines are intentionally outside
  // getFinancialIntelligence()'s bundle (see that file's own docstring),
  // so calling them directly here, for this one goal, is the established
  // pattern, not a new one.
  const priorityGoalTransactions = priorityGoal
    ? transactions.filter((t) => t.goal_id === priorityGoal.id)
    : [];
  const priorityGoalIntelligence = priorityGoal
    ? {
        forecast: forecastGoal(priorityGoal, priorityGoalTransactions),
        health: computeGoalHealth(priorityGoal, priorityGoalTransactions),
        coaching: coachingMessagesForGoal(priorityGoal, priorityGoalTransactions),
      }
    : null;

  return (
    <IntelligenceClient
      intelligence={intelligence}
      priorityGoal={priorityGoal}
      priorityGoalIntelligence={priorityGoalIntelligence}
      goals={goals.map((g) => ({ id: g.id, title: g.title }))}
      currencyCode={profile.currency_code ?? "ZAR"}
      locale={profile.locale ?? "en-ZA"}
    />
  );
}
