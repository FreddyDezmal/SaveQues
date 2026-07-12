/**
 * lib/habits.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 21 — Phase 2: Habit Engine.
 *
 * Every number here is derived from lib/analyticsEngine.ts (Sprint 19) —
 * this module does not re-derive deposit filtering, interval calculation,
 * or consistency scoring; it adds the habit-specific views Sprint 19 never
 * needed: hour-of-day rhythm, skipped-week counting, and a first-half vs
 * second-half consistency trend. Deterministic, pure, no ML.
 */

import {
  getDeposits,
  consistencyScore,
  mostFrequentDay,
  averageDepositIntervalDays,
  type Deposit,
} from "@/lib/analyticsEngine";
import { getUTCWeekStartString } from "@/lib/dateUtils";
import type { Transaction } from "@/lib/types";

export type RhythmType = "daily" | "weekly" | "biweekly" | "monthly" | "irregular";
export type SavingWindow = "morning" | "afternoon" | "evening" | "night" | "no clear pattern";
export type ConsistencyTrend = "improving" | "declining" | "stable" | "insufficient_data";

export interface HourFrequency { hour: number; count: number }

export interface DepositRhythm {
  type: RhythmType;
  typicalIntervalDays: number | null;
  explanation: string;
}

export interface HabitProfile {
  /** 0-100. See computeHabitScore() doc for the exact formula. */
  habitScore: number;
  habitScoreExplanation: string;
  depositRhythm: DepositRhythm;
  strongestSavingDay: { day: string; count: number } | null;
  strongestSavingHour: HourFrequency | null;
  preferredSavingWindow: SavingWindow;
  skippedWeekCount: number;
  consistencyTrend: ConsistencyTrend;
  /** 0-100 — how stable the habit is over time (low variance in the trend), distinct from the point-in-time consistencyScore. */
  habitStability: number | null;
  hasEnoughData: boolean;
}

const MIN_DEPOSITS = 5;

function hourOfDay(iso: string): number {
  return new Date(iso).getUTCHours();
}

function depositsByHour(deposits: Deposit[]): HourFrequency[] {
  const buckets: HourFrequency[] = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  for (const d of deposits) buckets[hourOfDay(d.created_at)].count += 1;
  return buckets;
}

/** Same minimum-sample + no-tie-guessing rule as analyticsEngine.mostFrequentDay(). */
function strongestHour(deposits: Deposit[]): HourFrequency | null {
  if (deposits.length < MIN_DEPOSITS) return null;
  const byHour = depositsByHour(deposits);
  const sorted = [...byHour].sort((a, b) => b.count - a.count);
  if (sorted[0].count === 0) return null;
  if (sorted[0].count === sorted[1].count) return null;
  return sorted[0];
}

function windowForHour(hour: number): SavingWindow {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

/**
 * Classifies the typical gap between deposits into a named rhythm.
 * Thresholds are on the *median-like* typical interval (average of
 * intervals), not a single sample, so one outlier deposit doesn't flip
 * the classification.
 */
function classifyRhythm(deposits: Deposit[]): DepositRhythm {
  const typical = averageDepositIntervalDays(deposits);
  if (typical === null) {
    return { type: "irregular", typicalIntervalDays: null, explanation: "Not enough deposits yet to detect a rhythm." };
  }
  const consistency = consistencyScore(deposits);
  // A rhythm needs both a typical gap AND reasonable regularity around it —
  // a "typical" 7-day gap with wildly inconsistent actual timing isn't
  // really a weekly rhythm, it's irregular saving that happens to average
  // out to 7 days.
  const regular = consistency !== null && consistency >= 55;

  if (!regular) {
    return {
      type: "irregular",
      typicalIntervalDays: Math.round(typical * 10) / 10,
      explanation: `Deposits average ${typical.toFixed(1)} days apart, but the timing is too irregular to call it a set rhythm (consistency score ${consistency ?? "n/a"}/100).`,
    };
  }

  let type: RhythmType;
  if (typical <= 2) type = "daily";
  else if (typical <= 9) type = "weekly";
  else if (typical <= 18) type = "biweekly";
  else type = "monthly";

  return {
    type,
    typicalIntervalDays: Math.round(typical * 10) / 10,
    explanation: `Deposits land roughly every ${typical.toFixed(1)} days, consistently enough to call it a ${type} rhythm.`,
  };
}

/** Number of UTC calendar weeks, since the first deposit, with zero deposits. */
function skippedWeekCount(deposits: Deposit[], now: Date): number {
  if (deposits.length === 0) return 0;
  const firstWeek = getUTCWeekStartString(new Date(deposits[0].created_at));
  const lastWeek = getUTCWeekStartString(now);
  const activeWeeks = new Set(deposits.map((d) => getUTCWeekStartString(new Date(d.created_at))));

  let cursor = firstWeek;
  let totalWeeks = 0;
  let skipped = 0;
  // Bounded walk from first deposit's week to the current week.
  while (cursor <= lastWeek && totalWeeks < 520) {
    // 10-year safety cap
    totalWeeks += 1;
    if (!activeWeeks.has(cursor)) skipped += 1;
    cursor = getUTCWeekStartString(new Date(new Date(cursor + "T00:00:00Z").getTime() + 7 * 86400000));
  }
  return skipped;
}

/**
 * Compares the consistency score of the first half of the user's deposit
 * history against the second half. Requires at least 6 deposits (3 per
 * half) — below that, a "trend" isn't meaningfully measurable, and
 * "insufficient_data" is returned rather than guessed.
 */
function computeConsistencyTrend(deposits: Deposit[]): { trend: ConsistencyTrend; stability: number | null } {
  if (deposits.length < 6) return { trend: "insufficient_data", stability: null };
  const mid = Math.floor(deposits.length / 2);
  const firstHalf = deposits.slice(0, mid);
  const secondHalf = deposits.slice(mid);
  const firstScore = consistencyScore(firstHalf);
  const secondScore = consistencyScore(secondHalf);
  if (firstScore === null || secondScore === null) return { trend: "insufficient_data", stability: null };

  const delta = secondScore - firstScore;
  const trend: ConsistencyTrend = delta >= 10 ? "improving" : delta <= -10 ? "declining" : "stable";
  // Stability: how close the two halves are to each other — small delta = stable habit.
  const stability = Math.max(0, 100 - Math.abs(delta));
  return { trend, stability };
}

/**
 * Habit score (0-100): a blend of point-in-time consistency (60%) and
 * tenure/volume confidence (40%, capped at 20 deposits = full marks —
 * more history makes a habit score more trustworthy, but doesn't need
 * to keep growing forever). Documented so the number is never a black box.
 */
function computeHabitScore(deposits: Deposit[]): { score: number; explanation: string } {
  const consistency = consistencyScore(deposits) ?? 0;
  const volumeConfidence = Math.min(1, deposits.length / 20);
  const score = Math.round(consistency * 0.6 + volumeConfidence * 100 * 0.4);
  return {
    score,
    explanation: `Consistency score ${consistency}/100 (weighted 60%) combined with a volume-confidence factor from ${deposits.length} deposit(s) (weighted 40%, capped at 20 deposits).`,
  };
}

export function computeHabitProfile(transactions: Transaction[], now: Date = new Date()): HabitProfile {
  const deposits = getDeposits(transactions);

  if (deposits.length < MIN_DEPOSITS) {
    return {
      habitScore: 0,
      habitScoreExplanation: `Fewer than ${MIN_DEPOSITS} deposits recorded — not enough evidence to score a habit yet.`,
      depositRhythm: { type: "irregular", typicalIntervalDays: null, explanation: "Not enough deposits yet to detect a rhythm." },
      strongestSavingDay: null,
      strongestSavingHour: null,
      preferredSavingWindow: "no clear pattern",
      skippedWeekCount: 0,
      consistencyTrend: "insufficient_data",
      habitStability: null,
      hasEnoughData: false,
    };
  }

  const { score, explanation } = computeHabitScore(deposits);
  const favoriteDay = mostFrequentDay(deposits);
  const favoriteHour = strongestHour(deposits);
  const { trend, stability } = computeConsistencyTrend(deposits);

  return {
    habitScore: score,
    habitScoreExplanation: explanation,
    depositRhythm: classifyRhythm(deposits),
    strongestSavingDay: favoriteDay ? { day: favoriteDay.day, count: favoriteDay.count } : null,
    strongestSavingHour: favoriteHour,
    preferredSavingWindow: favoriteHour ? windowForHour(favoriteHour.hour) : "no clear pattern",
    skippedWeekCount: skippedWeekCount(deposits, now),
    consistencyTrend: trend,
    habitStability: stability,
    hasEnoughData: true,
  };
}
