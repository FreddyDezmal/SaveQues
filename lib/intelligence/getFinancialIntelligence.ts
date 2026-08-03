/**
 * lib/intelligence/getFinancialIntelligence.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 28.5 — Phase 2: Financial Intelligence Orchestrator.
 *
 * THIS MODULE CALCULATES NOTHING. Every number in the object it returns
 * comes from a Sprint 19–28 engine that already existed and was already
 * shipped: lib/insights.ts, lib/weeklyReview.ts, lib/coaching.ts,
 * lib/habits.ts, lib/behaviorProfile.ts, lib/riskEngine.ts,
 * lib/interventions.ts, lib/accountHealth.ts, lib/categoryIntelligence.ts,
 * lib/financialHealthScore.ts, lib/cashFlowProjection.ts, and (added in
 * Sprint 28.5's Phase 3 pass, see that field's own comment below)
 * lib/recommendations.ts. This file's only job is to call them in the
 * right order with the right shared inputs and hand back one object, so a
 * caller (a page, an API route, a future Premium feature) doesn't have to
 * know that order or re-derive the shared `transactionsByGoal`/
 * `activityLog` shaping every engine needs.
 *
 * WHERE THIS CAME FROM: app/(app)/dashboard/page.tsx had grown this exact
 * sequence of ~10 calls inline, by hand, across Sprints 19–28 (each
 * sprint's own comment block still visible in that file's git history).
 * That was fine for one caller. Sprint 28.5's brief is explicit that
 * "Premium features should simply expose deeper intelligence rather than
 * introducing a second analytics system" — which requires this bundle to
 * be callable from more than one place without copy-pasting the dashboard
 * page's wiring. This file IS that inline block, moved and named, not
 * rewritten. Diffing this file against the removed dashboard code should
 * show identical call shapes.
 *
 * DELIBERATELY NOT DUPLICATED HERE: forecast.ts's per-goal
 * forecastGoal()/goalHealth.ts's computeGoalHealth() are NOT part of this
 * bundle. Both are inherently per-goal (need one specific goal's target/
 * current amount), not portfolio-wide, so they're called directly by
 * goal-detail-page code (see GoalDetailClient.tsx) rather than threaded
 * through here — bundling them would mean either running them for every
 * goal on every dashboard load (wasted work almost nobody's dashboard
 * displays) or accepting a `goalId` parameter that makes this module's
 * shape depend on which page is calling it. Same reasoning for
 * lib/portfolioSummary.ts's computePortfolioSummary() — already its own
 * single-purpose orchestration-adjacent function; this module doesn't
 * wrap it, callers that want both call both.
 */

import { generateInsights, type Insight } from "@/lib/insights";
import { buildWeeklyReview, type WeeklyReview } from "@/lib/weeklyReview";
import { generateCoachingMessages, type CoachingMessage } from "@/lib/coaching";
import { forecastGoal, type GoalForecast } from "@/lib/forecast";
import { computeGoalHealth, type GoalHealth } from "@/lib/goalHealth";
import { computeHabitProfile, type HabitProfile } from "@/lib/habits";
import { computeBehaviorProfile, type BehaviorProfile } from "@/lib/behaviorProfile";
import { computeBehavioralRisk, type BehavioralRisk } from "@/lib/riskEngine";
import { generateInterventions, type Intervention } from "@/lib/interventions";
import { computeAccountHealth, type AccountHealth } from "@/lib/accountHealth";
import { computeCategoryIntelligence, type CategoryIntelligence } from "@/lib/categoryIntelligence";
import { computeFinancialHealthScore, type FinancialHealthScore } from "@/lib/financialHealthScore";
import { projectCashFlow, type CashFlowProjection } from "@/lib/cashFlowProjection";
import { generateGoalRecommendations, type GoalRecommendation } from "@/lib/recommendations";
import type { SavingsGoal, Transaction } from "@/lib/types";

export interface FinancialIntelligenceInput {
  transactions: Transaction[];
  // Full SavingsGoal, not a narrowed Pick: computeCategoryIntelligence
  // (unlike every other engine here) needs the complete row shape. Every
  // other call below narrows what it needs itself via `.map()`, same as
  // the dashboard page did before this file existed.
  goals: SavingsGoal[];
  activityLog: { date: string; xp_earned: number; actions_count: number }[];
  achievements: { achievement_id: string; earned_at: string }[];
  profile: {
    streak_days: number;
    longest_streak: number;
    currency_code?: string | null;
    locale?: string | null;
  };
  now?: Date;
}

export interface FinancialIntelligence {
  insights: Insight[];
  weeklyReview: WeeklyReview;
  coachingMessages: CoachingMessage[];
  topCoachingMessage: string | null;
  habitProfile: HabitProfile;
  behaviorProfile: BehaviorProfile;
  behavioralRisk: BehavioralRisk;
  accountHealth: AccountHealth;
  interventions: Intervention[];
  categoryIntelligence: CategoryIntelligence;
  financialHealth: FinancialHealthScore;
  cashFlow: CashFlowProjection;
  /**
   * Sprint 28.5 — Phase 3: lib/recommendations.ts existed since Sprint 20
   * but was never actually called from anywhere in the app until now — a
   * real gap this orchestrator closes rather than something rebuilt.
   * Suggests up to 3 NEW goal categories the user doesn't already have an
   * active/completed goal in, sized to their own demonstrated saving
   * capacity. Distinct from `interventions` (which react to problems in
   * *existing* goals) and from a "which of my current goals should get my
   * next deposit" prioritizer, which does not exist in this codebase —
   * see this file's own audit trail for that correction.
   */
  goalRecommendations: GoalRecommendation[];
}

/**
 * Assembles the full financial intelligence bundle for one user from
 * already-fetched data. Callers are expected to gate this behind their own
 * "does this user have enough history to bother" check (the dashboard uses
 * `hasDeposit && userStage !== "new"`) — this function itself doesn't
 * refuse to run for a sparse user, since several of the underlying engines
 * (habitProfile, behaviorProfile, behavioralRisk) already return their own
 * documented "not enough data yet" neutral states rather than erroring,
 * and forcing a second, slightly-different gate here would be a second
 * place that same policy could drift out of sync.
 *
 * Pure and synchronous — no I/O, no network, no database access. Callers
 * own fetching `transactions`/`goals`/`activityLog`/`achievements` however
 * fits their context (a single dashboard RPC round trip today; a
 * different fetch shape for a future Premium endpoint tomorrow), and pass
 * the results in.
 */
export function getFinancialIntelligence(input: FinancialIntelligenceInput): FinancialIntelligence {
  const { transactions, goals, activityLog, achievements, profile } = input;
  const now = input.now ?? new Date();
  const currencyCode = profile.currency_code ?? "ZAR";
  const locale = profile.locale ?? "en-ZA";

  const insights = generateInsights(transactions, { currencyCode, locale, now });

  const weeklyReview = buildWeeklyReview({
    transactions,
    goals: goals.map((g) => ({ id: g.id, is_complete: g.is_complete })),
    achievements,
    activityLog,
    profile: { streak_days: profile.streak_days, longest_streak: profile.longest_streak },
    now,
  });

  const transactionsByGoal: Record<string, Transaction[]> = {};
  for (const t of transactions) {
    (transactionsByGoal[t.goal_id] ??= []).push(t);
  }
  const activeGoals = goals.filter((g) => !g.is_complete);

  // Sprint 30 — Phase 10 (Performance audit): forecastGoal()/
  // computeGoalHealth() were each being computed once here (inside
  // lib/coaching.ts's goalMessages, called below) and forecastGoal() a
  // second time inside lib/accountHealth.ts's forecast-reliability
  // factor — same goal, same transactions, same request. Computed once,
  // for every active goal, and shared into both. See CoachingContext's
  // and AccountHealthInputs' own comments on the two optional params
  // this feeds.
  const forecastsByGoalId = new Map<string, GoalForecast>();
  const healthByGoalId = new Map<string, GoalHealth>();
  for (const goal of activeGoals) {
    const goalTxs = transactionsByGoal[goal.id] ?? [];
    forecastsByGoalId.set(goal.id, forecastGoal(goal, goalTxs, now));
    healthByGoalId.set(goal.id, computeGoalHealth(goal, goalTxs, now));
  }

  const coachingMessages = generateCoachingMessages({
    transactions,
    goals: activeGoals.map((g) => ({
      id: g.id,
      title: g.title,
      target_amount: g.target_amount,
      current_amount: g.current_amount,
      target_date: g.target_date,
      is_complete: g.is_complete,
    })),
    transactionsByGoal,
    forecastsByGoalId,
    healthByGoalId,
  });
  const topCoachingMessage = coachingMessages[0]?.message ?? null;

  const habitProfile = computeHabitProfile(transactions, now);

  const behaviorProfile = computeBehaviorProfile({
    transactions,
    goals: goals.map((g) => ({ id: g.id, is_complete: g.is_complete })),
    streakDays: profile.streak_days,
    longestStreak: profile.longest_streak,
    now,
  });

  const behavioralRisk = computeBehavioralRisk({
    transactions,
    streakDays: profile.streak_days,
    longestStreak: profile.longest_streak,
    now,
  });

  const goalsForHealth = goals.map((g) => ({
    id: g.id,
    target_amount: g.target_amount,
    current_amount: g.current_amount,
    target_date: g.target_date,
    is_complete: g.is_complete,
  }));

  const accountHealth = computeAccountHealth({
    transactions,
    goals: goalsForHealth,
    activityLog,
    now,
    forecastsByGoalId,
  });

  const interventions = generateInterventions({
    behaviorProfile,
    risk: behavioralRisk,
    accountHealth,
    coachingMessages,
  });

  const categoryIntelligence = computeCategoryIntelligence(goals, transactions);

  // financialHealthScore reuses computeAccountHealth's own output (see that
  // module's docstring). Sprint 28.5 — Phase 8 (Performance): this used to
  // call computeFinancialHealthScore() without `accountHealth`, meaning it
  // silently recomputed the exact same AccountHealth this orchestrator had
  // just computed two lines above. computeFinancialHealthScore() now
  // accepts a precomputed AccountHealth for exactly this situation — pass
  // the one already sitting in `accountHealth` instead of paying for a
  // second identical pass over the same transactions/goals/activityLog.
  const financialHealth = computeFinancialHealthScore({
    transactions,
    goals: goals.map((g) => ({
      id: g.id,
      category: g.category,
      target_amount: g.target_amount,
      current_amount: g.current_amount,
      target_date: g.target_date,
      is_complete: g.is_complete,
    })),
    activityLog,
    now,
    accountHealth,
  });

  const cashFlow = projectCashFlow(
    transactions,
    goals.map((g) => ({ id: g.id, target_amount: g.target_amount, current_amount: g.current_amount, is_complete: g.is_complete })),
    now
  );

  const goalRecommendations = generateGoalRecommendations({
    transactions,
    goals: goals.map((g) => ({ id: g.id, category: g.category, is_complete: g.is_complete })),
    now,
  });

  return {
    insights,
    weeklyReview,
    coachingMessages,
    topCoachingMessage,
    habitProfile,
    behaviorProfile,
    behavioralRisk,
    accountHealth,
    interventions,
    categoryIntelligence,
    financialHealth,
    cashFlow,
    goalRecommendations,
  };
}
