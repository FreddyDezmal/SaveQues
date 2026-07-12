/**
 * lib/behaviorProfile.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 21 — Phase 3: Behavioral Profile.
 *
 * Intentionally distinct from lib/financialPersonality.ts (Sprint 20):
 * Financial Personality asks "what does this user's deposit *amounts and
 * timing* look like" (consistency, bursts, goal completion). Behavior
 * Profile asks "how engaged and habitual is this user's *saving
 * behaviour* over time" — rhythm stability, streak reliance, and
 * recovery-from-lapse patterns, built on lib/habits.ts (Sprint 21) rather
 * than raw lib/analyticsEngine.ts stats. The two will often agree, but
 * they're answering different questions with different evidence, so a
 * user can legitimately be both a Financial Personality "Consistent
 * Saver" and a Behavioral Profile "Streak Driven" saver at once.
 *
 * Same scored-candidate approach as financialPersonality.ts: every
 * candidate profile gets a 0-1 score from a documented rule, and the
 * highest scorer above MIN_CONFIDENCE wins. Below that bar (or with too
 * little history), "Building Habit" is returned as an honest low-
 * confidence default — never a random or forced label.
 */

import { getDeposits, mostFrequentDay, getDepositStats } from "@/lib/analyticsEngine";
import { computeHabitProfile } from "@/lib/habits";
import type { SavingsGoal, Transaction } from "@/lib/types";

export type BehaviorProfileType =
  | "Disciplined Saver"
  | "Payday Saver"
  | "Weekend Saver"
  | "Goal Driven"
  | "Streak Driven"
  | "Recovering Saver"
  | "Opportunistic Saver"
  | "Building Habit";

export interface BehaviorProfile {
  profile: BehaviorProfileType;
  confidence: number; // 0-1
  explanation: string;
  supportingMetrics: Record<string, string | number>;
}

const MIN_CONFIDENCE = 0.35;
const MIN_DEPOSITS = 5;

interface Candidate {
  profile: BehaviorProfileType;
  score: number;
  explanation: string;
  metrics: Record<string, string | number>;
}

/** Day-of-month clustering: how many deposits share the same day-of-month (±1 day) as the most common one. */
function dayOfMonthClusterStrength(deposits: { created_at: string }[]): { day: number; count: number } | null {
  if (deposits.length < MIN_DEPOSITS) return null;
  const counts = new Map<number, number>();
  for (const d of deposits) {
    const day = new Date(d.created_at).getUTCDate();
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  let best: { day: number; count: number } | null = null;
  for (const [day, count] of Array.from(counts.entries())) {
    if (!best || count > best.count) best = { day, count };
  }
  return best;
}

export interface BehaviorProfileInputs {
  transactions: Transaction[];
  goals: Pick<SavingsGoal, "id" | "is_complete">[];
  streakDays: number;
  longestStreak: number;
  now?: Date;
}

export function computeBehaviorProfile(inputs: BehaviorProfileInputs): BehaviorProfile {
  const now = inputs.now ?? new Date();
  const deposits = getDeposits(inputs.transactions);

  if (deposits.length < MIN_DEPOSITS) {
    return {
      profile: "Building Habit",
      confidence: 0.2,
      explanation: `Only ${deposits.length} deposit(s) so far — still early days for a behavioral read.`,
      supportingMetrics: { depositCount: deposits.length },
    };
  }

  const habits = computeHabitProfile(inputs.transactions, now);
  const candidates: Candidate[] = [];

  // ── Disciplined Saver ─────────────────────────────────────────────────
  if (habits.hasEnoughData) {
    candidates.push({
      profile: "Disciplined Saver",
      score: habits.habitScore / 100,
      explanation: `Habit score ${habits.habitScore}/100 — ${habits.depositRhythm.explanation}`,
      metrics: { habitScore: habits.habitScore, rhythm: habits.depositRhythm.type },
    });
  }

  // ── Payday Saver ──────────────────────────────────────────────────────
  const cluster = dayOfMonthClusterStrength(deposits);
  if (cluster && cluster.count >= 3) {
    candidates.push({
      profile: "Payday Saver",
      score: Math.min(1, cluster.count / deposits.length + 0.25),
      explanation: `${cluster.count} of ${deposits.length} deposits land on day ${cluster.day} of the month — a payday-aligned pattern.`,
      metrics: { clusterDay: cluster.day, clusterCount: cluster.count },
    });
  }

  // ── Weekend Saver ─────────────────────────────────────────────────────
  // Distinct evidence from Financial Personality's version: here it
  // requires the habit engine's *strongest saving day* to be a weekend AND
  // a stable-or-improving trend, i.e. it's asking "is weekend saving part
  // of a settled habit," not just "which day has the most deposits."
  const favoriteDay = mostFrequentDay(deposits);
  if (favoriteDay && (favoriteDay.dayIndex === 0 || favoriteDay.dayIndex === 6) && habits.consistencyTrend !== "declining") {
    candidates.push({
      profile: "Weekend Saver",
      score: Math.min(1, favoriteDay.count / deposits.length + 0.2),
      explanation: `Weekend saving (${favoriteDay.day}) is this user's strongest habit, and the trend is ${habits.consistencyTrend}.`,
      metrics: { favoriteDay: favoriteDay.day, consistencyTrend: habits.consistencyTrend },
    });
  }

  // ── Goal Driven ───────────────────────────────────────────────────────
  const activeGoalCount = inputs.goals.filter((g) => !g.is_complete).length;
  const goalTouchedDeposits = new Set(inputs.transactions.filter((t) => t.transaction_type === "deposit").map((t) => t.goal_id));
  if (activeGoalCount >= 2 && goalTouchedDeposits.size >= 2) {
    candidates.push({
      profile: "Goal Driven",
      score: Math.min(1, goalTouchedDeposits.size / Math.max(1, activeGoalCount) * 0.7 + 0.3),
      explanation: `Actively depositing across ${goalTouchedDeposits.size} different goals rather than a single focus.`,
      metrics: { activeGoalCount, goalsWithDeposits: goalTouchedDeposits.size },
    });
  }

  // ── Streak Driven ─────────────────────────────────────────────────────
  // Engagement (app-open streak) outpacing deposit habit strength — the
  // signal is "streak is doing more work than the deposit rhythm itself."
  if (inputs.longestStreak >= 7) {
    const streakRatio = inputs.streakDays / Math.max(1, inputs.longestStreak);
    const streakStrongerThanHabit = inputs.longestStreak >= 7 && habits.habitScore < 70;
    if (streakStrongerThanHabit) {
      candidates.push({
        profile: "Streak Driven",
        score: Math.min(1, 0.5 + streakRatio * 0.3 + Math.min(1, inputs.longestStreak / 30) * 0.2),
        explanation: `A ${inputs.longestStreak}-day best streak is a stronger signal here than deposit rhythm alone (habit score ${habits.habitScore}/100) — engagement is the driver.`,
        metrics: { streakDays: inputs.streakDays, longestStreak: inputs.longestStreak, habitScore: habits.habitScore },
      });
    }
  }

  // ── Recovering Saver ──────────────────────────────────────────────────
  // Distinct from Financial Personality's "Recovery Saver": this looks at
  // skipped weeks followed by a resumed, stabilizing rhythm — i.e. lapses
  // in *engagement*, not just a gap in deposit amounts.
  if (habits.skippedWeekCount >= 2 && habits.consistencyTrend === "improving") {
    candidates.push({
      profile: "Recovering Saver",
      score: Math.min(1, 0.5 + Math.min(1, habits.skippedWeekCount / 6) * 0.5),
      explanation: `${habits.skippedWeekCount} skipped week(s) in the history, but consistency is now improving — a recovering pattern.`,
      metrics: { skippedWeekCount: habits.skippedWeekCount, consistencyTrend: habits.consistencyTrend },
    });
  }

  // ── Opportunistic Saver ───────────────────────────────────────────────
  if (habits.depositRhythm.type === "irregular" && habits.habitStability !== null && habits.habitStability < 60) {
    candidates.push({
      profile: "Opportunistic Saver",
      score: Math.min(1, (100 - habits.habitStability) / 100),
      explanation: "No settled rhythm — deposits happen when opportunity or spare cash allows, rather than on a schedule.",
      metrics: { habitStability: habits.habitStability, rhythm: habits.depositRhythm.type },
    });
  }

  // ── Building Habit (floor/default) ───────────────────────────────────
  const stats = getDepositStats(deposits)!;
  candidates.push({
    profile: "Building Habit",
    score: 0.4,
    explanation: `${deposits.length} deposits so far, averaging ${Math.round(stats.average)} each — a habit still taking shape.`,
    metrics: { depositCount: deposits.length, averageDeposit: Math.round(stats.average) },
  });

  candidates.sort((a, b) => b.score - a.score);
  const winner = candidates[0];

  if (winner.score < MIN_CONFIDENCE) {
    const fallback = candidates.find((c) => c.profile === "Building Habit")!;
    return { profile: fallback.profile, confidence: fallback.score, explanation: fallback.explanation, supportingMetrics: fallback.metrics };
  }

  return {
    profile: winner.profile,
    confidence: Math.round(winner.score * 100) / 100,
    explanation: winner.explanation,
    supportingMetrics: winner.metrics,
  };
}
