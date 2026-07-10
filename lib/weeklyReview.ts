/**
 * lib/weeklyReview.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 19 — Phase 6: Weekly Financial Review.
 *
 * Produces a single, reusable, plain-data summary object (not UI) so the
 * same computation can back the dashboard card, a push notification, and
 * (future) email/PDF export without re-deriving anything. Built entirely on
 * lib/analyticsEngine.ts and lib/trends.ts — no new statistics are invented
 * here, only assembled and labelled.
 *
 * "This week" = the 7 days ending `now` (rolling), matching
 * lib/trends.ts's compareRecentPeriods rather than introducing a second,
 * slightly-different Monday-aligned definition of "week".
 */

import { getDeposits, getDepositStats, consistencyScore } from "@/lib/analyticsEngine";
import { compareRecentPeriods } from "@/lib/trends";
import { getUTCDateString } from "@/lib/dateUtils";
import type { Transaction, SavingsGoal } from "@/lib/types";

export interface WeeklyReview {
  weekEnding: string; // UTC "YYYY-MM-DD"
  weeklySavings: number;
  changeFromPreviousWeek: { amount: number; percent: number | null; direction: "up" | "down" | "flat" | "unknown" };
  goalsProgressed: number;
  goalsCompleted: number;
  xpEarned: number;
  achievementsUnlocked: { achievementId: string; earnedAt: string }[];
  currentStreak: number;
  longestStreak: number;
  bestSavingDay: { date: string; amount: number } | null;
  mostActiveDay: { date: string; actionsCount: number } | null;
  averageDeposit: number | null;
  consistencyScore: number | null;
  mostImprovedMetric: { metric: "savings_total" | "deposit_count"; percentImproved: number } | null;
  hasEnoughData: boolean;
}

export interface WeeklyReviewInputs {
  transactions: Transaction[];
  goals: Pick<SavingsGoal, "id" | "is_complete">[];
  achievements: { achievement_id: string; earned_at: string }[];
  activityLog: { date: string; xp_earned: number; actions_count: number }[];
  profile: { streak_days: number; longest_streak: number };
  now?: Date;
}

function withinLastNDays(iso: string, now: Date, days: number): boolean {
  const t = new Date(iso).getTime();
  return t >= now.getTime() - days * 86400000 && t <= now.getTime();
}

export function buildWeeklyReview(inputs: WeeklyReviewInputs): WeeklyReview {
  const now = inputs.now ?? new Date();
  const { transactions, goals, achievements, activityLog, profile } = inputs;

  const deposits = getDeposits(transactions);
  const thisWeekDeposits = deposits.filter((d) => withinLastNDays(d.created_at, now, 7));

  const weeklySavings = thisWeekDeposits.reduce((s, d) => s + Number(d.amount), 0);
  const cmp = compareRecentPeriods(transactions, 7, now);

  // Goals progressed: distinct goals that received a deposit this week.
  const goalsProgressed = new Set(thisWeekDeposits.map((d) => d.goal_id)).size;

  // Goals completed this week: is_complete goals whose most recent
  // transaction (of any type) falls within the window. Reuses the same
  // transaction list rather than requiring a separate completed_at fetch.
  const goalIdsComplete = new Set(goals.filter((g) => g.is_complete).map((g) => g.id));
  const lastTxByGoal = new Map<string, string>();
  for (const t of transactions) {
    const existing = lastTxByGoal.get(t.goal_id);
    if (!existing || new Date(t.created_at) > new Date(existing)) lastTxByGoal.set(t.goal_id, t.created_at);
  }
  let goalsCompleted = 0;
  for (const goalId of goalIdsComplete) {
    const lastTx = lastTxByGoal.get(goalId);
    if (lastTx && withinLastNDays(lastTx, now, 7)) goalsCompleted += 1;
  }

  const weekActivity = activityLog.filter((a) => withinLastNDays(a.date, now, 7));
  const xpEarned = weekActivity.reduce((s, a) => s + a.xp_earned, 0);

  const achievementsUnlocked = achievements
    .filter((a) => withinLastNDays(a.earned_at, now, 7))
    .map((a) => ({ achievementId: a.achievement_id, earnedAt: a.earned_at }));

  // Best saving day: highest total deposit amount, by UTC calendar date.
  const byDay = new Map<string, number>();
  for (const d of thisWeekDeposits) {
    const key = getUTCDateString(new Date(d.created_at));
    byDay.set(key, (byDay.get(key) ?? 0) + Number(d.amount));
  }
  let bestSavingDay: WeeklyReview["bestSavingDay"] = null;
  for (const [date, amount] of byDay.entries()) {
    if (!bestSavingDay || amount > bestSavingDay.amount) bestSavingDay = { date, amount };
  }

  // Most active day: highest actions_count from activity_log (already tracked
  // by the gamification system — reused rather than re-derived from raw events).
  let mostActiveDay: WeeklyReview["mostActiveDay"] = null;
  for (const a of weekActivity) {
    if (!mostActiveDay || a.actions_count > mostActiveDay.actionsCount) {
      mostActiveDay = { date: a.date, actionsCount: a.actions_count };
    }
  }

  const weekStats = getDepositStats(thisWeekDeposits);
  const averageDeposit = weekStats?.average ?? null;

  // Consistency is measured against the user's full deposit history — a
  // single week rarely has enough intervals (needs >=3 deposits) to produce
  // a meaningful score on its own.
  const overallConsistency = consistencyScore(deposits);

  let mostImprovedMetric: WeeklyReview["mostImprovedMetric"] = null;
  if (cmp.previousTotal > 0 && cmp.previousCount > 0) {
    const savingsChange = ((cmp.currentTotal - cmp.previousTotal) / cmp.previousTotal) * 100;
    const countChange = ((cmp.currentCount - cmp.previousCount) / cmp.previousCount) * 100;
    if (savingsChange > 0 || countChange > 0) {
      mostImprovedMetric =
        savingsChange >= countChange
          ? { metric: "savings_total", percentImproved: Math.round(savingsChange) }
          : { metric: "deposit_count", percentImproved: Math.round(countChange) };
    }
  }

  return {
    weekEnding: getUTCDateString(now),
    weeklySavings,
    changeFromPreviousWeek: {
      amount: cmp.currentTotal - cmp.previousTotal,
      percent: cmp.percentChange,
      direction: cmp.direction,
    },
    goalsProgressed,
    goalsCompleted,
    xpEarned,
    achievementsUnlocked,
    currentStreak: profile.streak_days,
    longestStreak: profile.longest_streak,
    bestSavingDay,
    mostActiveDay,
    averageDeposit,
    consistencyScore: overallConsistency,
    mostImprovedMetric,
    hasEnoughData: thisWeekDeposits.length > 0,
  };
}
