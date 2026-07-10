/**
 * lib/portfolioSummary.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 20 — Phase 10: Portfolio Dashboard.
 *
 * Pure aggregation of every engine built across Sprint 19/20 into one
 * "premium overview" data shape. Deliberately does not add any new
 * statistics — every field is sourced from an existing module, so this
 * file is assembly, not computation.
 */

import { getDeposits, getDepositStats } from "@/lib/analyticsEngine";
import { getLevelFromXP } from "@/lib/xp";
import { computeFinancialPersonality, type FinancialPersonality } from "@/lib/financialPersonality";
import { computeAccountHealth, type AccountHealth } from "@/lib/accountHealth";
import { buildMonthlyReport, type MonthlyReport } from "@/lib/monthlyReport";
import type { SavingsGoal, Transaction } from "@/lib/types";

export interface PortfolioSummary {
  lifetimeSaved: number;
  currentSavings: number;
  completedGoalsCount: number;
  activeGoalsCount: number;
  xpTotal: number;
  level: number;
  levelTitle: string;
  achievementsCount: number;
  currentStreak: number;
  longestStreak: number;
  financialPersonality: FinancialPersonality;
  healthScore: AccountHealth;
  monthlyPerformance: MonthlyReport;
  recentMilestoneLabels: string[];
}

export interface PortfolioSummaryInputs {
  transactions: Transaction[];
  goals: Pick<SavingsGoal, "id" | "title" | "target_amount" | "current_amount" | "target_date" | "is_complete">[];
  achievements: { achievement_id: string; earned_at: string }[];
  activityLog: { date: string; xp_earned: number }[];
  profile: { xp_total: number; streak_days: number; longest_streak: number };
  now?: Date;
}

export function buildPortfolioSummary(inputs: PortfolioSummaryInputs): PortfolioSummary {
  const now = inputs.now ?? new Date();
  const deposits = getDeposits(inputs.transactions);
  const stats = getDepositStats(deposits);
  const level = getLevelFromXP(inputs.profile.xp_total);

  const completedGoals = inputs.goals.filter((g) => g.is_complete);
  const activeGoals = inputs.goals.filter((g) => !g.is_complete);
  const currentSavings = activeGoals.reduce((s, g) => s + Number(g.current_amount), 0) + completedGoals.reduce((s, g) => s + Number(g.current_amount), 0);

  const financialPersonality = computeFinancialPersonality({
    transactions: inputs.transactions,
    goals: inputs.goals,
    activityLog: inputs.activityLog,
    now,
  });

  const healthScore = computeAccountHealth({
    transactions: inputs.transactions,
    goals: inputs.goals,
    activityLog: inputs.activityLog,
    now,
  });

  const monthlyPerformance = buildMonthlyReport({
    transactions: inputs.transactions,
    goals: inputs.goals,
    achievements: inputs.achievements,
    activityLog: inputs.activityLog,
    profile: { streak_days: inputs.profile.streak_days, longest_streak: inputs.profile.longest_streak },
    now,
  });

  const recentMilestoneLabels: string[] = [];
  if (monthlyPerformance.topMilestone) recentMilestoneLabels.push(monthlyPerformance.topMilestone);
  for (const g of completedGoals.slice(-3).reverse()) {
    const label = `Completed "${g.title}"`;
    if (!recentMilestoneLabels.includes(label)) recentMilestoneLabels.push(label);
  }

  return {
    lifetimeSaved: stats?.total ?? 0,
    currentSavings,
    completedGoalsCount: completedGoals.length,
    activeGoalsCount: activeGoals.length,
    xpTotal: inputs.profile.xp_total,
    level: level.level,
    levelTitle: level.title,
    achievementsCount: inputs.achievements.length,
    currentStreak: inputs.profile.streak_days,
    longestStreak: inputs.profile.longest_streak,
    financialPersonality,
    healthScore,
    monthlyPerformance,
    recentMilestoneLabels: recentMilestoneLabels.slice(0, 5),
  };
}
