/**
 * lib/coaching.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 19 — Phase 7: Coaching Engine.
 *
 * Rule-based, not generative — every message is a fixed template filled
 * in from real numbers already computed by analyticsEngine/forecast/
 * goalHealth/weeklyReview. No randomness, no LLM calls, nothing invented.
 *
 * House rules enforced by construction, not just by convention:
 *   - Encourage, never shame: there is no template here that criticises a
 *     user for a gap, a missed streak, or a slow pace without also naming
 *     something constructive or achievable.
 *   - No artificial urgency: deadline-related messages only fire when a
 *     real target_date exists and is genuinely close — never invented
 *     scarcity ("only 3 spots left"-style language does not belong here).
 *   - No exaggeration: numbers are always the exact computed value, never
 *     rounded up for effect or amplified with adjectives the data doesn't
 *     support.
 */

import { getDeposits, mostFrequentDay, consistencyScore } from "@/lib/analyticsEngine";
import { forecastGoal, type GoalForecast } from "@/lib/forecast";
import { computeGoalHealth, type GoalHealth } from "@/lib/goalHealth";
import type { SavingsGoal, Transaction } from "@/lib/types";

export interface CoachingMessage {
  id: string;
  goalId?: string;
  message: string;
  /** Rough priority for callers that only want to show the top few. Higher = show first. */
  priority: number;
}

interface GoalCoachingInput {
  goal: Pick<SavingsGoal, "id" | "title" | "target_amount" | "current_amount" | "target_date" | "is_complete">;
  transactions: Transaction[]; // this goal's transactions only
  /**
   * Sprint 30 — Phase 10 (Performance audit): optional, additive. When the
   * caller (generateCoachingMessages, via getFinancialIntelligence) has
   * already computed this goal's forecast/health for another purpose in
   * the same request, pass it here instead of recomputing — see
   * CoachingContext's own comment for the full "computed twice" finding.
   * Falls back to computing internally (identical to the previous
   * behavior) when omitted, so coachingMessagesForGoal() — which has no
   * reason to precompute anything for a single goal — is unaffected.
   */
  precomputedForecast?: GoalForecast;
  precomputedHealth?: GoalHealth;
}

/** Coaching messages that look at overall saving behaviour (not tied to one goal). */
function behaviorMessages(allTransactions: Transaction[]): CoachingMessage[] {
  const deposits = getDeposits(allTransactions);
  const messages: CoachingMessage[] = [];

  const favoriteDay = mostFrequentDay(deposits);
  if (favoriteDay) {
    messages.push({
      id: "favorite_day_habit",
      message: `Saving on ${favoriteDay.day}s has become one of your strongest habits.`,
      priority: 5,
    });
  }

  const consistency = consistencyScore(deposits);
  if (consistency !== null && consistency >= 70 && deposits.length >= 5) {
    messages.push({
      id: "consistent_smaller_deposits",
      message: "Making deposits regularly — even smaller ones — has helped keep your saving consistent.",
      priority: 4,
    });
  }

  return messages;
}

/** Coaching messages scoped to a single goal, using its forecast + health. */
function goalMessages({ goal, transactions, precomputedForecast, precomputedHealth }: GoalCoachingInput): CoachingMessage[] {
  if (goal.is_complete) return [];

  const messages: CoachingMessage[] = [];
  const forecast = precomputedForecast ?? forecastGoal(goal, transactions);
  const health = precomputedHealth ?? computeGoalHealth(goal, transactions);
  const deposits = getDeposits(transactions);

  // "Two deposits away" — only fires when we can support the exact number:
  // remaining amount divided by the average of the last 3 deposits, rounded.
  if (deposits.length >= 3 && forecast.remaining > 0) {
    const lastThreeAvg = deposits.slice(-3).reduce((s, d) => s + Number(d.amount), 0) / 3;
    if (lastThreeAvg > 0) {
      const depositsAway = Math.round(forecast.remaining / lastThreeAvg);
      if (depositsAway >= 1 && depositsAway <= 3) {
        messages.push({
          id: "almost_there",
          goalId: goal.id,
          message: `You're only about ${depositsAway} deposit${depositsAway === 1 ? "" : "s"} away from completing "${goal.title}", at your recent pace.`,
          priority: 9,
        });
      }
    }
  }

  // Inactivity nudge — factual, not shaming, and always paired with the
  // fact that the goal is still reachable rather than a guilt statement.
  const activityFactor = health.factors.find((f) => f.name === "Recent activity");
  if (activityFactor && activityFactor.points === 0 && deposits.length > 0) {
    const weeksSince = Math.max(1, Math.round((activityFactor.explanation.match(/\d+/)?.[0] ? Number(activityFactor.explanation.match(/\d+/)![0]) : 0) / 7));
    messages.push({
      id: "inactivity_nudge",
      goalId: goal.id,
      message: `You haven't added to "${goal.title}" in about ${weeksSince} week${weeksSince === 1 ? "" : "s"} — it's still within reach whenever you're ready to pick it back up.`,
      priority: 6,
    });
  }

  // On-pace-for-deadline — only fires with a real target_date and a real,
  // supportable pace comparison (never invented urgency).
  if (goal.target_date && forecast.paceStatus === "on_track") {
    messages.push({
      id: "on_pace_for_deadline",
      goalId: goal.id,
      message: `Completing "${goal.title}" by your target date is achievable if you maintain your current pace.`,
      priority: 7,
    });
  } else if (goal.target_date && forecast.paceStatus === "ahead") {
    messages.push({
      id: "ahead_of_pace",
      goalId: goal.id,
      message: `You're ahead of the pace needed to hit your target date for "${goal.title}".`,
      priority: 7,
    });
  }

  return messages;
}

export interface CoachingContext {
  transactions: Transaction[]; // all transactions across all goals
  goals: Pick<SavingsGoal, "id" | "title" | "target_amount" | "current_amount" | "target_date" | "is_complete">[];
  /** Per-goal transaction lists (already filtered), keyed by goal_id. Callers already have this from goal detail fetches. */
  transactionsByGoal: Record<string, Transaction[]>;
  /**
   * Sprint 30 — Phase 10 (Performance audit): getFinancialIntelligence()
   * was calling forecastGoal()/computeGoalHealth() once per active goal
   * here, then lib/accountHealth.ts was calling forecastGoal() again for
   * the exact same goals in the exact same request — the same
   * computation done twice for no reason other than each module not
   * knowing the other had already done it. Both maps are optional and
   * additive: any existing caller that doesn't pass them (including
   * coachingMessagesForGoal, which only ever handles one goal at a time
   * and has nothing to share) sees byte-identical behavior.
   */
  forecastsByGoalId?: Map<string, GoalForecast>;
  healthByGoalId?: Map<string, GoalHealth>;
}

/**
 * Builds the full set of coaching messages, highest priority first. Callers
 * typically show the top 1-3 (dashboard: top 1; goal detail: messages for
 * that goal only).
 */
export function generateCoachingMessages(ctx: CoachingContext): CoachingMessage[] {
  const messages: CoachingMessage[] = [...behaviorMessages(ctx.transactions)];

  for (const goal of ctx.goals) {
    const goalTxs = ctx.transactionsByGoal[goal.id] ?? [];
    messages.push(
      ...goalMessages({
        goal,
        transactions: goalTxs,
        precomputedForecast: ctx.forecastsByGoalId?.get(goal.id),
        precomputedHealth: ctx.healthByGoalId?.get(goal.id),
      })
    );
  }

  return messages.sort((a, b) => b.priority - a.priority);
}

export function coachingMessagesForGoal(
  goal: GoalCoachingInput["goal"],
  transactions: Transaction[]
): CoachingMessage[] {
  return goalMessages({ goal, transactions }).sort((a, b) => b.priority - a.priority);
}
