/**
 * lib/challenges.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 20 — Phase 5: Smart Challenges.
 *
 * Every challenge's target is derived from the user's own recent history
 * (lib/analyticsEngine.ts, lib/weeklyReview.ts) so it's always achievable
 * in principle — "beat your longest streak" uses their actual longest
 * streak, "save more than last week" uses their actual last-week total,
 * etc. Nothing is a flat, one-size-fits-all number. Challenges that
 * wouldn't make sense yet (e.g. "beat your streak" for a user with a
 * 0-week streak) are simply not generated.
 *
 * Pure and deterministic: same inputs + same `now` always produce the same
 * challenge set, so "expiry" and "progress" can be recomputed safely on
 * every page load rather than needing a persisted challenge-state table
 * this sprint (see docs/SPRINT20_PERSONALIZATION.md for that follow-up).
 */

import { getDeposits, weeklySavingStreak } from "@/lib/analyticsEngine";
import { compareRecentPeriods } from "@/lib/trends";
import { getUTCWeekStartString } from "@/lib/dateUtils";
import type { SavingsGoal, Transaction } from "@/lib/types";

export type ChallengeDifficulty = "easy" | "medium" | "hard";

export interface Challenge {
  id: string;
  title: string;
  description: string;
  difficulty: ChallengeDifficulty;
  xpReward: number;
  /** 0-1 */
  progress: number;
  isComplete: boolean;
  /** UTC "YYYY-MM-DD" — always the end of the current UTC week. */
  expiresAt: string;
}

export interface ChallengeInputs {
  transactions: Transaction[];
  goals: Pick<SavingsGoal, "id" | "is_complete">[];
  streakDays: number;
  longestStreak: number;
  xpTotal: number;
  now?: Date;
}

function weekEndDate(now: Date): string {
  const weekStart = new Date(getUTCWeekStartString(now) + "T00:00:00Z");
  return getUTCWeekStartString(new Date(weekStart.getTime() + 6 * 86400000));
}

function inCurrentWeek(iso: string, now: Date): boolean {
  return getUTCWeekStartString(new Date(iso)) === getUTCWeekStartString(now);
}

export function generateWeeklyChallenges(inputs: ChallengeInputs): Challenge[] {
  const now = inputs.now ?? new Date();
  const deposits = getDeposits(inputs.transactions);
  const expiresAt = weekEndDate(now);
  const challenges: Challenge[] = [];

  const thisWeekDeposits = deposits.filter((d) => inCurrentWeek(d.created_at, now));
  const thisWeekTotal = thisWeekDeposits.reduce((s, d) => s + Number(d.amount), 0);
  const thisWeekCount = thisWeekDeposits.length;

  // ── Save more than last week ─────────────────────────────────────────
  const cmp = compareRecentPeriods(inputs.transactions, 7, now);
  if (cmp.previousTotal > 0) {
    challenges.push({
      id: "beat_last_week",
      title: "Beat last week",
      description: `Save more than last week's ${Math.round(cmp.previousTotal)} total.`,
      difficulty: "medium",
      xpReward: 50,
      progress: Math.min(1, thisWeekTotal / (cmp.previousTotal || 1)),
      isComplete: thisWeekTotal > cmp.previousTotal,
      expiresAt,
    });
  }

  // ── Deposit twice before the week ends ───────────────────────────────
  challenges.push({
    id: "two_deposits",
    title: "Deposit twice this week",
    description: "Make at least 2 deposits before the week ends.",
    difficulty: "easy",
    xpReward: 25,
    progress: Math.min(1, thisWeekCount / 2),
    isComplete: thisWeekCount >= 2,
    expiresAt,
  });

  // ── Beat your longest streak ─────────────────────────────────────────
  if (inputs.longestStreak >= 3) {
    challenges.push({
      id: "beat_longest_streak",
      title: "Beat your longest streak",
      description: `Reach a ${inputs.longestStreak + 1}-day streak (your record is ${inputs.longestStreak}).`,
      difficulty: "hard",
      xpReward: 150,
      progress: Math.min(1, inputs.streakDays / (inputs.longestStreak + 1)),
      isComplete: inputs.streakDays > inputs.longestStreak,
      expiresAt,
    });
  }

  // Note: a "maintain your streak" challenge was considered here, but its
  // true completion state depends on server-side streak-continuation logic
  // (lib/streaks.ts / the update_streak RPC) that this pure, client-safe
  // engine deliberately does not duplicate. Rather than show a challenge
  // that can never honestly report isComplete from this engine alone, it's
  // omitted — the existing streak UI already covers that job well.

  // ── Complete a goal ───────────────────────────────────────────────────
  const activeGoalCount = inputs.goals.filter((g) => !g.is_complete).length;
  // "Completed this week" — same technique lib/weeklyReview.ts uses: a
  // completed goal whose most recent transaction (of any type) falls in
  // the current week. There's no completed_at column to check directly
  // (see Sprint 19 audit), so this is the same reliable proxy already
  // established there.
  const lastTxByGoal = new Map<string, string>();
  for (const t of inputs.transactions) {
    const existing = lastTxByGoal.get(t.goal_id);
    if (!existing || new Date(t.created_at) > new Date(existing)) lastTxByGoal.set(t.goal_id, t.created_at);
  }
  const completedThisWeek = inputs.goals.some((g) => {
    if (!g.is_complete) return false;
    const lastTx = lastTxByGoal.get(g.id);
    return !!lastTx && inCurrentWeek(lastTx, now);
  });
  if (activeGoalCount > 0) {
    challenges.push({
      id: "complete_a_goal",
      title: "Complete a goal",
      description: "Finish one of your active goals this week.",
      difficulty: "hard",
      xpReward: 200,
      progress: completedThisWeek ? 1 : 0,
      isComplete: completedThisWeek,
      expiresAt,
    });
  }

  // ── Weekly saving-streak challenge (using savings behaviour, not app-open streak) ──
  const savingStreak = weeklySavingStreak(deposits, now);
  if (savingStreak.current >= 1) {
    challenges.push({
      id: "weekly_target",
      title: "Complete your weekly target",
      description: "Make at least one deposit this week to keep your weekly saving streak going.",
      difficulty: "easy",
      xpReward: 30,
      progress: thisWeekCount >= 1 ? 1 : 0,
      isComplete: thisWeekCount >= 1,
      expiresAt,
    });
  }

  return challenges;
}
