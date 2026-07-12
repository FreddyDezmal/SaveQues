/**
 * lib/habitReflection.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 21 — Phase 11: Weekly Reflection Engine.
 *
 * AUDIT NOTE (Phase 1): the brief asks for this module at `lib/reflection.ts`,
 * but that path is already a real, wired-in feature — `generateReflection()`
 * / `shouldShowReflection()`, consumed by
 * `components/gamification/weeklyReflectionModal.tsx` and
 * `app/(app)/quests/page.tsx`. It produces short notification-style copy
 * from simple pre-computed counts (savingsCount, questsCompleted, streak).
 * Per this sprint's engineering rules ("never rewrite working systems",
 * "treat the implementation as source of truth over sprint-summary
 * assumptions"), that file was left untouched. This module covers the
 * different, more analytical ask in the Phase 11 brief (biggest win, most
 * consistent/hardest week, most improved habit, next focus) under a
 * distinct name instead of colliding with or replacing the existing
 * system. Both can coexist; a future sprint could have the existing
 * `weeklyReflectionModal` pull its `insight` line from this engine's
 * `mostImprovedHabit`/`nextFocus` fields if richer copy is wanted.
 *
 * Builds on lib/weeklyReview.ts (Sprint 19) and lib/habits.ts (Sprint 21)
 * rather than re-deriving weekly totals or consistency numbers. Pure data,
 * no JSX — notification-ready, matching the existing reflection.ts's own
 * "no shame, no guilt, forward-facing" copy rule.
 */

import { buildWeeklyReview, type WeeklyReview } from "@/lib/weeklyReview";
import { computeHabitProfile } from "@/lib/habits";
import { getDeposits } from "@/lib/analyticsEngine";
import { getUTCWeekStartString } from "@/lib/dateUtils";
import type { Transaction, SavingsGoal } from "@/lib/types";

export interface WeeklyBehaviorReflection {
  biggestWin: string | null;
  mostConsistentWeek: { weekStart: string; depositCount: number } | null;
  hardestWeek: { weekStart: string; depositCount: number } | null;
  mostImprovedHabit: string | null;
  nextFocus: string | null;
  encouragement: string;
  hasEnoughData: boolean;
}

export interface HabitReflectionInputs {
  transactions: Transaction[];
  goals: Pick<SavingsGoal, "id" | "is_complete">[];
  achievements: { achievement_id: string; earned_at: string }[];
  activityLog: { date: string; xp_earned: number; actions_count: number }[];
  profile: { streak_days: number; longest_streak: number };
  now?: Date;
}

/** Deposit count per UTC week, across the whole history — used to find the most/least consistent weeks. */
function weeklyDepositCounts(transactions: Transaction[]): Map<string, number> {
  const deposits = getDeposits(transactions);
  const counts = new Map<string, number>();
  for (const d of deposits) {
    const key = getUTCWeekStartString(new Date(d.created_at));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function buildWeeklyBehaviorReflection(inputs: HabitReflectionInputs): WeeklyBehaviorReflection {
  const now = inputs.now ?? new Date();
  const review: WeeklyReview = buildWeeklyReview({
    transactions: inputs.transactions,
    goals: inputs.goals,
    achievements: inputs.achievements,
    activityLog: inputs.activityLog,
    profile: inputs.profile,
    now,
  });
  const habits = computeHabitProfile(inputs.transactions, now);

  if (!review.hasEnoughData) {
    return {
      biggestWin: null,
      mostConsistentWeek: null,
      hardestWeek: null,
      mostImprovedHabit: null,
      nextFocus: habits.hasEnoughData
        ? "Make one deposit this week to keep the data flowing — even a small one counts."
        : "Log a first deposit to start building a saving history.",
      encouragement: "Every saving history starts with a single deposit — there's no wrong time to make the first one.",
      hasEnoughData: false,
    };
  }

  // ── Biggest win ────────────────────────────────────────────────────────
  let biggestWin: string | null = null;
  if (review.goalsCompleted > 0) {
    biggestWin = `Completed ${review.goalsCompleted} goal${review.goalsCompleted > 1 ? "s" : ""} this week.`;
  } else if (review.achievementsUnlocked.length > 0) {
    biggestWin = `Unlocked ${review.achievementsUnlocked.length} achievement${review.achievementsUnlocked.length > 1 ? "s" : ""}.`;
  } else if (review.changeFromPreviousWeek.direction === "up") {
    biggestWin = `Saved ${Math.round(review.changeFromPreviousWeek.amount)} more than last week.`;
  } else if (review.bestSavingDay) {
    biggestWin = `Biggest single-day saving day: ${review.bestSavingDay.date}.`;
  }

  // ── Most consistent / hardest week (across the full history, for context) ──
  const weeklyCounts = weeklyDepositCounts(inputs.transactions);
  let mostConsistentWeek: WeeklyBehaviorReflection["mostConsistentWeek"] = null;
  let hardestWeek: WeeklyBehaviorReflection["hardestWeek"] = null;
  for (const [weekStart, depositCount] of Array.from(weeklyCounts.entries())) {
    if (!mostConsistentWeek || depositCount > mostConsistentWeek.depositCount) {
      mostConsistentWeek = { weekStart, depositCount };
    }
    if (!hardestWeek || depositCount < hardestWeek.depositCount) {
      hardestWeek = { weekStart, depositCount };
    }
  }

  // ── Most improved habit ──────────────────────────────────────────────
  let mostImprovedHabit: string | null = null;
  if (habits.consistencyTrend === "improving") {
    mostImprovedHabit = "Saving consistency is trending up compared to earlier in the history.";
  } else if (review.mostImprovedMetric) {
    mostImprovedHabit =
      review.mostImprovedMetric.metric === "savings_total"
        ? `Total saved is up ${review.mostImprovedMetric.percentImproved}% vs. the prior week.`
        : `Deposit frequency is up ${review.mostImprovedMetric.percentImproved}% vs. the prior week.`;
  }

  // ── Next focus ────────────────────────────────────────────────────────
  let nextFocus: string;
  if (habits.consistencyTrend === "declining") {
    nextFocus = "Consistency has dipped recently — even a smaller, more frequent deposit can help rebuild the rhythm.";
  } else if (review.goalsProgressed === 0) {
    nextFocus = "No goals were touched this week — picking one to focus on could help next week's reflection.";
  } else if (habits.skippedWeekCount > 0 && habits.consistencyTrend !== "improving") {
    nextFocus = "There have been some skipped weeks in the past — keeping this week's rhythm going would help build a longer streak of active weeks.";
  } else {
    nextFocus = "Keep doing what's working — the current rhythm is a good one to protect.";
  }

  // ── Encouragement ─────────────────────────────────────────────────────
  const encouragement =
    review.weeklySavings > 0
      ? "Progress this week, however it looked, is still progress — that's worth recognizing."
      : "A quiet week isn't a lost one — the habit is still there, ready to pick back up.";

  return { biggestWin, mostConsistentWeek, hardestWeek, mostImprovedHabit, nextFocus, encouragement, hasEnoughData: true };
}
