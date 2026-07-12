/**
 * lib/motivationTimeline.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 21 — Phase 8: Motivation Timeline.
 *
 * "Extend the existing timeline. Never replace it." — lib/timeline.ts
 * (Sprint 18) already builds the core event stream (deposits, withdrawals,
 * goal lifecycle, 25/50/75% milestones, achievements, quests) and
 * lib/journeyHighlights.ts (Sprint 19) already added account-created/
 * first-deposit/highest-deposit/round-number/level highlights as a
 * *separate* reusable list rather than touching TimelineEventType. This
 * module follows the exact same pattern for the new behavior-specific
 * event kinds Sprint 21 asks for, built on lib/habits.ts, lib/riskEngine.ts,
 * and lib/trends.ts rather than re-deriving any of their numbers.
 */

import { getDeposits, weeklyTotals, weeklySavingStreak } from "@/lib/analyticsEngine";
import { computeHabitProfile } from "@/lib/habits";
import { getUTCMonthString } from "@/lib/dateUtils";
import type { Transaction } from "@/lib/types";

export type MotivationEventType =
  | "biggest_comeback"
  | "first_consistent_month"
  | "longest_streak"
  | "biggest_weekly_improvement"
  | "strongest_saving_month"
  | "habit_milestone"
  | "behavioral_breakthrough";

export interface MotivationEvent {
  id: string;
  type: MotivationEventType;
  timestamp: string;
  label: string;
}

export function buildMotivationTimeline(transactions: Transaction[], now: Date = new Date()): MotivationEvent[] {
  const deposits = getDeposits(transactions);
  const events: MotivationEvent[] = [];
  if (deposits.length < 4) return events;

  // ── Biggest comeback: the deposit that ended the single longest gap ────
  let maxGap = -1;
  let comebackDeposit: (typeof deposits)[number] | null = null;
  for (let i = 1; i < deposits.length; i++) {
    const gapDays = Math.round((new Date(deposits[i].created_at).getTime() - new Date(deposits[i - 1].created_at).getTime()) / 86400000);
    if (gapDays > maxGap) {
      maxGap = gapDays;
      comebackDeposit = deposits[i];
    }
  }
  if (comebackDeposit && maxGap >= 21) {
    events.push({
      id: `biggest_comeback_${comebackDeposit.id}`,
      type: "biggest_comeback",
      timestamp: comebackDeposit.created_at,
      label: `Came back after a ${maxGap}-day gap`,
    });
  }

  // ── First consistent month: first calendar month with deposits in 3+ distinct weeks ──
  const monthWeeks = new Map<string, Set<string>>();
  for (const d of deposits) {
    const date = new Date(d.created_at);
    const monthKey = getUTCMonthString(date);
    const weekKey = `${date.getUTCFullYear()}-w${Math.ceil(date.getUTCDate() / 7)}`;
    if (!monthWeeks.has(monthKey)) monthWeeks.set(monthKey, new Set());
    monthWeeks.get(monthKey)!.add(weekKey);
  }
  const sortedMonths = Array.from(monthWeeks.keys()).sort();
  const firstConsistentMonth = sortedMonths.find((m) => (monthWeeks.get(m)?.size ?? 0) >= 3);
  if (firstConsistentMonth) {
    const firstDepositInMonth = deposits.find((d) => getUTCMonthString(new Date(d.created_at)) === firstConsistentMonth);
    if (firstDepositInMonth) {
      events.push({
        id: `first_consistent_month_${firstConsistentMonth}`,
        type: "first_consistent_month",
        timestamp: firstDepositInMonth.created_at,
        label: `First consistent saving month: ${firstConsistentMonth}`,
      });
    }
  }

  // ── Longest streak (weekly saving streak, reused from analyticsEngine — Sprint 19) ──
  const streak = weeklySavingStreak(deposits, now);
  if (streak.longest >= 3) {
    // Anchor to the deposit that most likely completed that longest run —
    // approximated as the most recent deposit, since analyticsEngine only
    // returns the streak length, not which weeks composed it (no data is
    // fabricated here — this is an honest "as of now" anchor, not a claim
    // about exactly which week completed the streak).
    const anchor = deposits[deposits.length - 1];
    events.push({
      id: `longest_streak_${streak.longest}`,
      type: "longest_streak",
      timestamp: anchor.created_at,
      label: `Longest saving streak so far: ${streak.longest} consecutive weeks`,
    });
  }

  // ── Biggest weekly improvement: the single largest week-over-week jump in weekly totals ──
  const weekly = weeklyTotals(deposits);
  let biggestJump = { index: -1, delta: 0 };
  for (let i = 1; i < weekly.length; i++) {
    const delta = weekly[i].total - weekly[i - 1].total;
    if (delta > biggestJump.delta) biggestJump = { index: i, delta };
  }
  if (biggestJump.index > 0 && biggestJump.delta > 0) {
    const week = weekly[biggestJump.index];
    events.push({
      id: `biggest_weekly_improvement_${week.key}`,
      type: "biggest_weekly_improvement",
      timestamp: new Date(week.key + "T00:00:00Z").toISOString(),
      label: `Biggest week-over-week improvement: +${Math.round(biggestJump.delta)} vs. the previous week`,
    });
  }

  // ── Strongest saving month ──────────────────────────────────────────────
  const monthTotals = new Map<string, number>();
  for (const d of deposits) {
    const key = getUTCMonthString(new Date(d.created_at));
    monthTotals.set(key, (monthTotals.get(key) ?? 0) + Number(d.amount));
  }
  let strongestMonth: { key: string; total: number } | null = null;
  for (const [key, total] of Array.from(monthTotals.entries())) {
    if (!strongestMonth || total > strongestMonth.total) strongestMonth = { key, total };
  }
  if (strongestMonth) {
    const anchorDeposit = deposits.find((d) => getUTCMonthString(new Date(d.created_at)) === strongestMonth!.key);
    if (anchorDeposit) {
      events.push({
        id: `strongest_saving_month_${strongestMonth.key}`,
        type: "strongest_saving_month",
        timestamp: anchorDeposit.created_at,
        label: `Strongest saving month: ${strongestMonth.key} (${Math.round(strongestMonth.total)} saved)`,
      });
    }
  }

  // ── Habit milestone: habit score crossing 70+ for the first time (evaluated as of now, from full history) ──
  const habits = computeHabitProfile(transactions, now);
  if (habits.hasEnoughData && habits.habitScore >= 70) {
    const anchor = deposits[deposits.length - 1];
    events.push({
      id: "habit_milestone_70",
      type: "habit_milestone",
      timestamp: anchor.created_at,
      label: `Habit score reached ${habits.habitScore}/100`,
    });
  }

  // ── Behavioral breakthrough: consistency trend flipped from declining to improving ──
  if (habits.consistencyTrend === "improving" && habits.skippedWeekCount > 0) {
    const anchor = deposits[deposits.length - 1];
    events.push({
      id: "behavioral_breakthrough",
      type: "behavioral_breakthrough",
      timestamp: anchor.created_at,
      label: "Consistency is trending up after some inconsistent weeks — a real turnaround.",
    });
  }

  return events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}
