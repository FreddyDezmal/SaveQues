/**
 * lib/intelligence/getFinancialIntelligence.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 28.5 — Phase 2: Financial Intelligence Orchestrator.
 *
 * AUDIT CONTEXT (see docs/Sprint 28.5/SPRINT28_5_PHASE1_AUDIT.md): every
 * calculation this file touches already exists and already shipped
 * (Sprints 19–28). Nothing here recomputes anything. What's genuinely
 * missing is a single, reusable place that assembles those modules into
 * one object — today that assembly is either duplicated inline (the ~80
 * lines in app/(app)/dashboard/page.tsx under "Sprint 19: Intelligence
 * layer") or simply absent (portfolio and goal-detail pages call a subset
 * of these modules directly, or not at all). This file is that place.
 *
 * This module MUST NOT calculate anything itself. Every value below is a
 * direct pass-through to an existing `lib/*.ts` function. If a new metric
 * is ever needed, it belongs in the relevant existing module (or a new
 * one), never inlined here.
 *
 * Gating: mirrors the dashboard's existing convention — with zero
 * deposits there is nothing honest to say, so every field is null/empty
 * rather than computed against an empty array (see dashboard/page.tsx's
 * `hasDeposit` gate and cashFlowProjection.ts's own "don't fabricate a
 * neutral default" principle).
 *
 * Dashboard note: app/(app)/dashboard/page.tsx is intentionally NOT
 * migrated to call this orchestrator in this sprint. It already computes
 * `accountHealthForInterventions` once and reuses it for both
 * `interventions` and (indirectly, inside financialHealthScore.ts)
 * financial health — reshaping that specific call graph to fit a generic
 * orchestrator either re-triggers a duplicate computeAccountHealth() call
 * or requires the orchestrator to special-case the dashboard's exact
 * ordering. Per this sprint's own instruction to preserve working,
 * tested architecture rather than force a conflicting shape onto it,
 * that migration is left as a documented future step (see
 * FINANCIAL_INTELLIGENCE_INTEGRATION.md, "Extension points"). Every
 * *new* integration point added this sprint (portfolio) calls this
 * orchestrator instead of hand-rolling the same assembly a third time.
 */

import { getDeposits } from "@/lib/analyticsEngine";
import { computeAccountHealth, type AccountHealth } from "@/lib/accountHealth";
import { computeFinancialHealthScore, type FinancialHealthScore } from "@/lib/financialHealthScore";
import { projectCashFlow, type CashFlowProjection } from "@/lib/cashFlowProjection";
import { computeBehaviorProfile, type BehaviorProfile } from "@/lib/behaviorProfile";
import { computeBehavioralRisk, type BehavioralRisk } from "@/lib/riskEngine";
import { generateInterventions, type Intervention } from "@/lib/interventions";
import { computeCategoryIntelligence, type CategoryIntelligence } from "@/lib/categoryIntelligence";
import { generateInsights, type Insight } from "@/lib/insights";
import { generateGoalRecommendations, type GoalRecommendation } from "@/lib/recommendations";
import { generateCoachingMessages, type CoachingMessage } from "@/lib/coaching";
import type { SavingsGoal, Transaction } from "@/lib/types";

export interface FinancialIntelligenceInputs {
  transactions: Transaction[];
  /** Full goal rows — computeCategoryIntelligence needs the full shape; every other module here only reads a subset of it. */
  goals: SavingsGoal[];
  activityLog: { date: string; xp_earned: number; actions_count?: number }[];
  profile: {
    streak_days: number;
    longest_streak: number;
    currency_code?: string;
    locale?: string;
  };
  now?: Date;
  /** Passed through to generateGoalRecommendations. Default 3 (that module's own default). */
  maxRecommendations?: number;
}

export interface FinancialIntelligence {
  /** False when there isn't at least one deposit — every field below is null/empty in that case. */
  hasEnoughData: boolean;
  insufficientDataReason: string | null;

  accountHealth: AccountHealth | null;
  financialHealthScore: FinancialHealthScore | null;
  cashFlow: CashFlowProjection | null;
  behaviorProfile: BehaviorProfile | null;
  behavioralRisk: BehavioralRisk | null;
  interventions: Intervention[];
  categoryIntelligence: CategoryIntelligence | null;
  insights: Insight[];
  coachingMessages: CoachingMessage[];
  recommendations: GoalRecommendation[];

  // Convenience "top" picks — the same objects already sorted
  // highest-priority-first by their own module, just unwrapped for
  // callers (dashboard widgets, cards) that only want the headline item.
  topInsight: Insight | null;
  topRecommendation: GoalRecommendation | null;
  topCoachingMessage: string | null;
  topInterventionMessage: string | null;
}

function emptyIntelligence(reason: string): FinancialIntelligence {
  return {
    hasEnoughData: false,
    insufficientDataReason: reason,
    accountHealth: null,
    financialHealthScore: null,
    cashFlow: null,
    behaviorProfile: null,
    behavioralRisk: null,
    interventions: [],
    categoryIntelligence: null,
    insights: [],
    coachingMessages: [],
    recommendations: [],
    topInsight: null,
    topRecommendation: null,
    topCoachingMessage: null,
    topInterventionMessage: null,
  };
}

/**
 * Orchestrates every existing financial-intelligence module for one user
 * into a single object. Pure assembly — see module comment. Safe to call
 * once per page render; callers should NOT call individual modules again
 * afterward for data already present here (that would be the exact
 * duplicate computation this file exists to prevent).
 */
export function getFinancialIntelligence(inputs: FinancialIntelligenceInputs): FinancialIntelligence {
  const now = inputs.now ?? new Date();
  const deposits = getDeposits(inputs.transactions);

  // Recommendations are the one exception to the "gate on deposits" rule:
  // generateGoalRecommendations already handles a zero-deposit user
  // itself (unscaled "starter estimate" templates — see that module's own
  // comment), and a brand-new user with no goals yet is exactly who most
  // needs a first suggestion. Compute it before the early return.
  const recommendations = generateGoalRecommendations({
    transactions: inputs.transactions,
    goals: inputs.goals,
    now,
    maxResults: inputs.maxRecommendations,
  });

  if (deposits.length === 0) {
    const empty = emptyIntelligence(
      "No deposits recorded yet, so most of the intelligence layer has nothing to say — recommendations still work from goal templates alone."
    );
    return { ...empty, recommendations, topRecommendation: recommendations[0] ?? null };
  }

  const activityLog = inputs.activityLog.map((a) => ({
    date: a.date,
    xp_earned: a.xp_earned,
    actions_count: a.actions_count ?? 0,
  }));

  const accountHealth = computeAccountHealth({
    transactions: inputs.transactions,
    goals: inputs.goals,
    activityLog,
    now,
  });

  const financialHealthScore = computeFinancialHealthScore({
    transactions: inputs.transactions,
    goals: inputs.goals,
    activityLog,
    now,
  });

  const cashFlow = projectCashFlow(inputs.transactions, inputs.goals, now);

  const behaviorProfile = computeBehaviorProfile({
    transactions: inputs.transactions,
    goals: inputs.goals,
    streakDays: inputs.profile.streak_days,
    longestStreak: inputs.profile.longest_streak,
    now,
  });

  const behavioralRisk = computeBehavioralRisk({
    transactions: inputs.transactions,
    streakDays: inputs.profile.streak_days,
    longestStreak: inputs.profile.longest_streak,
    now,
  });

  const categoryIntelligence = computeCategoryIntelligence(inputs.goals, inputs.transactions, now);

  const insights = generateInsights(inputs.transactions, {
    currencyCode: inputs.profile.currency_code ?? "ZAR",
    locale: inputs.profile.locale ?? "en-ZA",
    now,
  });

  const transactionsByGoal: Record<string, Transaction[]> = {};
  for (const t of inputs.transactions) {
    (transactionsByGoal[t.goal_id] ??= []).push(t);
  }
  const coachingMessages = generateCoachingMessages({
    transactions: inputs.transactions,
    goals: inputs.goals.filter((g) => !g.is_complete),
    transactionsByGoal,
  });

  const accountHealthForInterventions = accountHealth; // same call, reused — never a second computeAccountHealth()
  const interventions = generateInterventions({
    behaviorProfile,
    risk: behavioralRisk,
    accountHealth: accountHealthForInterventions,
    coachingMessages,
  });

  return {
    hasEnoughData: true,
    insufficientDataReason: null,
    accountHealth,
    financialHealthScore,
    cashFlow,
    behaviorProfile,
    behavioralRisk,
    interventions,
    categoryIntelligence,
    insights,
    coachingMessages,
    recommendations,
    topInsight: insights[0] ?? null,
    topRecommendation: recommendations[0] ?? null,
    topCoachingMessage: coachingMessages[0]?.message ?? null,
    topInterventionMessage: interventions[0]?.title ?? null,
  };
}
