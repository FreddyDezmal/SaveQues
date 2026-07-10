/**
 * lib/monthlyReport.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 20 — Phase 6: Monthly Financial Report.
 *
 * Same "reusable plain-data object" pattern as lib/weeklyReview.ts (Sprint
 * 19), scaled to a calendar month, and pulling in the Sprint 19/20 engines
 * (goal health, forecast, coaching, financial personality) rather than
 * recomputing any of their logic. Intended to back a dashboard card today
 * and PDF/email export later — export wiring is out of scope this sprint,
 * per the brief.
 */

import { getDeposits, getDepositStats } from "@/lib/analyticsEngine";
import { getUTCMonthString, getUTCDateString } from "@/lib/dateUtils";
import { computeGoalHealth, type GoalHealthStatus } from "@/lib/goalHealth";
import { forecastGoal } from "@/lib/forecast";
import { coachingMessagesForGoal } from "@/lib/coaching";
import type { SavingsGoal, Transaction } from "@/lib/types";

export interface MonthlyReport {
  monthKey: string; // UTC "YYYY-MM"
  monthlySavings: number;
  savingsChangeFromPreviousMonth: { amount: number; percent: number | null };
  depositFrequency: number; // deposits/week, this month
  averageDeposit: number | null;
  bestSavingDay: { date: string; amount: number } | null;
  goalsCompleted: number;
  achievementsUnlocked: number;
  xpEarned: number;
  currentStreak: number;
  longestStreak: number;
  goalHealthSummary: { goalId: string; status: GoalHealthStatus; score: number }[];
  forecastSummary: { goalId: string; projectedCompletionDate: string | null; paceStatus: string }[];
  coachingSummary: string[];
  topMilestone: string | null;
  mostImprovedMetric: { metric: string; percentImproved: number } | null;
  mostConsistentWeek: { weekStart: string; count: number } | null;
  hasEnoughData: boolean;
}

export interface MonthlyReportInputs {
  transactions: Transaction[];
  goals: Pick<SavingsGoal, "id" | "title" | "target_amount" | "current_amount" | "target_date" | "is_complete">[];
  achievements: { achievement_id: string; earned_at: string }[];
  activityLog: { date: string; xp_earned: number }[];
  profile: { streak_days: number; longest_streak: number };
  now?: Date;
}

function inMonth(iso: string, monthKey: string): boolean {
  return getUTCMonthString(new Date(iso)) === monthKey;
}

export function buildMonthlyReport(inputs: MonthlyReportInputs): MonthlyReport {
  const now = inputs.now ?? new Date();
  const monthKey = getUTCMonthString(now);
  const prevMonthKey = getUTCMonthString(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));

  const deposits = getDeposits(inputs.transactions);
  const thisMonthDeposits = deposits.filter((d) => inMonth(d.created_at, monthKey));
  const prevMonthDeposits = deposits.filter((d) => inMonth(d.created_at, prevMonthKey));

  const monthlySavings = thisMonthDeposits.reduce((s, d) => s + Number(d.amount), 0);
  const prevMonthTotal = prevMonthDeposits.reduce((s, d) => s + Number(d.amount), 0);
  const percent = prevMonthTotal === 0 ? null : ((monthlySavings - prevMonthTotal) / prevMonthTotal) * 100;

  const daysElapsedThisMonth = now.getUTCDate();
  const depositFrequency = thisMonthDeposits.length / Math.max(1, daysElapsedThisMonth / 7);

  const stats = getDepositStats(thisMonthDeposits);

  // Best saving day this month
  const byDay = new Map<string, number>();
  for (const d of thisMonthDeposits) {
    const key = getUTCDateString(new Date(d.created_at));
    byDay.set(key, (byDay.get(key) ?? 0) + Number(d.amount));
  }
  let bestSavingDay: MonthlyReport["bestSavingDay"] = null;
  for (const [date, amount] of Array.from(byDay.entries())) {
    if (!bestSavingDay || amount > bestSavingDay.amount) bestSavingDay = { date, amount };
  }

  // Goals completed this month (same "last transaction in window" proxy as weeklyReview.ts)
  const lastTxByGoal = new Map<string, string>();
  for (const t of inputs.transactions) {
    const existing = lastTxByGoal.get(t.goal_id);
    if (!existing || new Date(t.created_at) > new Date(existing)) lastTxByGoal.set(t.goal_id, t.created_at);
  }
  const goalsCompleted = inputs.goals.filter((g) => {
    if (!g.is_complete) return false;
    const lastTx = lastTxByGoal.get(g.id);
    return !!lastTx && inMonth(lastTx, monthKey);
  }).length;

  const achievementsUnlocked = inputs.achievements.filter((a) => inMonth(a.earned_at, monthKey)).length;
  const xpEarned = inputs.activityLog.filter((a) => inMonth(a.date, monthKey)).reduce((s, a) => s + a.xp_earned, 0);

  // Per-goal health/forecast for active goals — reused from Sprint 19 engines, not recomputed.
  const activeGoals = inputs.goals.filter((g) => !g.is_complete);
  const goalHealthSummary = activeGoals.map((g) => {
    const goalTxs = inputs.transactions.filter((t) => t.goal_id === g.id);
    const health = computeGoalHealth(g, goalTxs, now);
    return { goalId: g.id, status: health.status, score: health.score };
  });
  const forecastSummary = activeGoals.map((g) => {
    const goalTxs = inputs.transactions.filter((t) => t.goal_id === g.id);
    const forecast = forecastGoal(g, goalTxs, now);
    return { goalId: g.id, projectedCompletionDate: forecast.projectedCompletionDate, paceStatus: forecast.paceStatus };
  });
  const coachingSummary = activeGoals
    .flatMap((g) => coachingMessagesForGoal(g, inputs.transactions.filter((t) => t.goal_id === g.id)))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 3)
    .map((m) => m.message);

  // Top milestone this month: highest single deposit, or a goal completion if one happened.
  let topMilestone: string | null = null;
  if (goalsCompleted > 0) {
    const completedTitle = inputs.goals.find((g) => {
      if (!g.is_complete) return false;
      const lastTx = lastTxByGoal.get(g.id);
      return !!lastTx && inMonth(lastTx, monthKey);
    })?.title;
    topMilestone = completedTitle ? `Completed "${completedTitle}"` : null;
  } else if (thisMonthDeposits.length > 0) {
    const largest = thisMonthDeposits.reduce((a, b) => (Number(b.amount) > Number(a.amount) ? b : a));
    topMilestone = `Largest deposit this month: ${Math.round(Number(largest.amount))}`;
  }

  const mostImprovedMetric =
    prevMonthTotal > 0 && percent !== null && percent > 0
      ? { metric: "monthly_savings", percentImproved: Math.round(percent) }
      : null;

  // Most consistent week: the UTC week (within this month) with the highest deposit count.
  const weeklyCounts = new Map<string, number>();
  for (const d of thisMonthDeposits) {
    const w = getUTCMonthString(new Date(d.created_at)) + "-w" + Math.ceil(new Date(d.created_at).getUTCDate() / 7);
    weeklyCounts.set(w, (weeklyCounts.get(w) ?? 0) + 1);
  }
  let mostConsistentWeek: MonthlyReport["mostConsistentWeek"] = null;
  for (const [weekStart, count] of Array.from(weeklyCounts.entries())) {
    if (!mostConsistentWeek || count > mostConsistentWeek.count) mostConsistentWeek = { weekStart, count };
  }

  return {
    monthKey,
    monthlySavings,
    savingsChangeFromPreviousMonth: { amount: monthlySavings - prevMonthTotal, percent },
    depositFrequency: Math.round(depositFrequency * 10) / 10,
    averageDeposit: stats?.average ?? null,
    bestSavingDay,
    goalsCompleted,
    achievementsUnlocked,
    xpEarned,
    currentStreak: inputs.profile.streak_days,
    longestStreak: inputs.profile.longest_streak,
    goalHealthSummary,
    forecastSummary,
    coachingSummary,
    topMilestone,
    mostImprovedMetric,
    mostConsistentWeek,
    hasEnoughData: thisMonthDeposits.length > 0,
  };
}
