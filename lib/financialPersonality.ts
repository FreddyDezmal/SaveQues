/**
 * lib/financialPersonality.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 20 — Phase 2: Financial Personality Engine.
 *
 * Every personality is a scored, explainable outcome of real statistics
 * from lib/analyticsEngine.ts, lib/forecast.ts, and lib/momentum.ts — never
 * a random pick. Each candidate personality gets a 0–1 score from a
 * documented rule; the highest-scoring candidate above MIN_CONFIDENCE wins.
 * Below that bar, "Steady Builder" is returned as an honest low-confidence
 * default rather than a stretch classification.
 */

import {
  getDeposits,
  consistencyScore,
  mostFrequentDay,
  longestInactivityGapDays,
  averageDepositsPerWeek,
  getDepositStats,
  type Deposit,
} from "@/lib/analyticsEngine";
import { forecastGoal } from "@/lib/forecast";
import { getMomentumState } from "@/lib/momentum";
import { getUTCDateString, utcDaysBetween } from "@/lib/dateUtils";
import type { SavingsGoal, Transaction } from "@/lib/types";

export type FinancialPersonalityType =
  | "Consistent Saver"
  | "Weekend Saver"
  | "Burst Saver"
  | "Goal Chaser"
  | "Recovery Saver"
  | "High Momentum Saver"
  | "Strategic Planner"
  | "Steady Builder";

export interface FinancialPersonality {
  personality: FinancialPersonalityType;
  confidence: number; // 0-1
  explanation: string;
  contributingMetrics: Record<string, string | number>;
}

const MIN_CONFIDENCE = 0.35;
const MIN_DEPOSITS_FOR_CONFIDENT_READ = 5;

interface Candidate {
  personality: FinancialPersonalityType;
  score: number;
  explanation: string;
  metrics: Record<string, string | number>;
}

function multiDepositDayRatio(deposits: Deposit[]): number {
  if (deposits.length === 0) return 0;
  const byDay = new Map<string, number>();
  for (const d of deposits) {
    const key = getUTCDateString(new Date(d.created_at));
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  const activeDays = byDay.size;
  const multiDays = Array.from(byDay.values()).filter((c) => c > 1).length;
  return activeDays === 0 ? 0 : multiDays / activeDays;
}

/** Average deposit amount before vs. after the single longest inactivity gap. */
function recoverySignal(deposits: Deposit[]): { before: number; after: number; gapDays: number } | null {
  if (deposits.length < 4) return null;
  let gapIndex = -1;
  let maxGap = -1;
  for (let i = 1; i < deposits.length; i++) {
    const gap = utcDaysBetween(new Date(deposits[i - 1].created_at), new Date(deposits[i].created_at));
    if (gap > maxGap) {
      maxGap = gap;
      gapIndex = i;
    }
  }
  if (gapIndex < 2 || maxGap < 14) return null; // need real history on both sides, and a genuine gap
  const beforeSlice = deposits.slice(0, gapIndex);
  const afterSlice = deposits.slice(gapIndex);
  if (beforeSlice.length < 2 || afterSlice.length < 2) return null;
  const avg = (arr: Deposit[]) => arr.reduce((s, d) => s + Number(d.amount), 0) / arr.length;
  return { before: avg(beforeSlice), after: avg(afterSlice), gapDays: maxGap };
}

export interface FinancialPersonalityInputs {
  transactions: Transaction[];
  goals: Pick<SavingsGoal, "id" | "target_amount" | "current_amount" | "target_date" | "is_complete">[];
  activityLog: { date: string; xp_earned: number }[];
  now?: Date;
}

export function computeFinancialPersonality(inputs: FinancialPersonalityInputs): FinancialPersonality {
  const now = inputs.now ?? new Date();
  const deposits = getDeposits(inputs.transactions);
  const candidates: Candidate[] = [];

  if (deposits.length < MIN_DEPOSITS_FOR_CONFIDENT_READ) {
    return {
      personality: "Steady Builder",
      confidence: 0.2,
      explanation: `Not enough deposit history yet (${deposits.length} deposit${deposits.length === 1 ? "" : "s"}) for a confident read — this is a starting default, not a strong signal.`,
      contributingMetrics: { depositCount: deposits.length },
    };
  }

  const consistency = consistencyScore(deposits);
  const favoriteDay = mostFrequentDay(deposits);
  const longestGap = longestInactivityGapDays(deposits);
  const perWeek = averageDepositsPerWeek(deposits);
  const stats = getDepositStats(deposits)!;
  const momentum = getMomentumState(inputs.activityLog);

  // ── Consistent Saver ──────────────────────────────────────────────────
  if (consistency !== null) {
    candidates.push({
      personality: "Consistent Saver",
      score: consistency / 100,
      explanation: `Deposits land on a regular rhythm — consistency score ${consistency}/100.`,
      metrics: { consistencyScore: consistency },
    });
  }

  // ── Weekend Saver ─────────────────────────────────────────────────────
  if (favoriteDay && (favoriteDay.dayIndex === 0 || favoriteDay.dayIndex === 6)) {
    candidates.push({
      personality: "Weekend Saver",
      score: Math.min(1, favoriteDay.count / deposits.length + 0.3),
      explanation: `Most deposits happen on ${favoriteDay.day} — a weekend saving pattern.`,
      metrics: { favoriteDay: favoriteDay.day, favoriteDayCount: favoriteDay.count },
    });
  }

  // ── Burst Saver ───────────────────────────────────────────────────────
  const multiDayRatio = multiDepositDayRatio(deposits);
  if (consistency !== null) {
    const burstScore = (1 - consistency / 100) * 0.6 + multiDayRatio * 0.4;
    candidates.push({
      personality: "Burst Saver",
      score: burstScore,
      explanation: `Saving happens in irregular bursts rather than a steady rhythm (consistency ${consistency}/100, ${Math.round(multiDayRatio * 100)}% of active days had multiple deposits).`,
      metrics: { consistencyScore: consistency, multiDepositDayRatio: Math.round(multiDayRatio * 100) },
    });
  }

  // ── Goal Chaser ───────────────────────────────────────────────────────
  const completedGoals = inputs.goals.filter((g) => g.is_complete);
  if (inputs.goals.length > 0 && completedGoals.length > 0) {
    const completionRate = completedGoals.length / inputs.goals.length;
    candidates.push({
      personality: "Goal Chaser",
      score: Math.min(1, completionRate * 0.7 + Math.min(1, completedGoals.length / 3) * 0.3),
      explanation: `${completedGoals.length} of ${inputs.goals.length} goals completed — a strong finish-what-you-start pattern.`,
      metrics: { goalsCompleted: completedGoals.length, totalGoals: inputs.goals.length },
    });
  }

  // ── Recovery Saver ────────────────────────────────────────────────────
  const recovery = recoverySignal(deposits);
  if (recovery && recovery.after > recovery.before * 1.15) {
    const boost = Math.min(1, (recovery.after / recovery.before - 1));
    candidates.push({
      personality: "Recovery Saver",
      score: Math.min(1, 0.5 + boost * 0.5),
      explanation: `After a ${recovery.gapDays}-day gap, saving picked back up stronger than before (up from an average of ${Math.round(recovery.before)} to ${Math.round(recovery.after)} per deposit).`,
      metrics: { gapDays: recovery.gapDays, avgBefore: Math.round(recovery.before), avgAfter: Math.round(recovery.after) },
    });
  }

  // ── High Momentum Saver ───────────────────────────────────────────────
  if (momentum.state === "on_fire" || momentum.state === "unstoppable") {
    candidates.push({
      personality: "High Momentum Saver",
      score: momentum.score,
      explanation: `Momentum is currently "${momentum.label}" — ${momentum.description}`,
      metrics: { momentumState: momentum.state, momentumScore: Math.round(momentum.score * 100) },
    });
  }

  // ── Strategic Planner ─────────────────────────────────────────────────
  const goalsWithTargetDate = inputs.goals.filter((g) => g.target_date && !g.is_complete);
  if (goalsWithTargetDate.length > 0) {
    const onTrackCount = goalsWithTargetDate.filter((g) => {
      const f = forecastGoal(g, inputs.transactions.filter((t) => t.goal_id === g.id), now);
      return f.paceStatus === "on_track" || f.paceStatus === "ahead";
    }).length;
    const targetDateRatio = goalsWithTargetDate.length / Math.max(1, inputs.goals.filter((g) => !g.is_complete).length);
    const onTrackRatio = onTrackCount / goalsWithTargetDate.length;
    candidates.push({
      personality: "Strategic Planner",
      score: targetDateRatio * 0.4 + onTrackRatio * 0.6,
      explanation: `${goalsWithTargetDate.length} active goal(s) have a target date, and ${onTrackCount} of those are currently on pace to hit it.`,
      metrics: { goalsWithTargetDate: goalsWithTargetDate.length, onTrackCount },
    });
  }

  // ── Steady Builder (always available as the floor/default) ──────────────
  candidates.push({
    personality: "Steady Builder",
    score: 0.4,
    explanation: `Saving an average of ${Math.round(stats.average)} per deposit at roughly ${perWeek ? perWeek.toFixed(1) : "0"} deposits/week — steady, unremarkable-in-a-good-way progress.`,
    metrics: { averageDeposit: Math.round(stats.average), depositsPerWeek: perWeek ? Math.round(perWeek * 10) / 10 : 0 },
  });

  candidates.sort((a, b) => b.score - a.score);
  const winner = candidates[0];

  if (winner.score < MIN_CONFIDENCE) {
    const fallback = candidates.find((c) => c.personality === "Steady Builder")!;
    return {
      personality: fallback.personality,
      confidence: fallback.score,
      explanation: fallback.explanation,
      contributingMetrics: fallback.metrics,
    };
  }

  return {
    personality: winner.personality,
    confidence: Math.round(winner.score * 100) / 100,
    explanation: winner.explanation,
    contributingMetrics: { ...winner.metrics, longestInactivityGapDays: longestGap ?? 0 },
  };
}
