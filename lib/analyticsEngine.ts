/**
 * lib/analyticsEngine.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 19 — Phase 2: Analytics Engine
 *
 * Single source of truth for every number derived from a user's deposit
 * history (averages, totals, frequency, consistency, streaks). Every other
 * intelligence module (insights, forecasting, goal health, weekly review,
 * coaching) is built on top of these functions rather than recomputing
 * anything itself — see docs/SPRINT19_INTELLIGENCE.md for the dependency
 * graph.
 *
 * Design rules (see Sprint 19 brief):
 *   - Pure, deterministic functions only. No I/O, no Date.now() unless
 *     passed in as `now`, so every function is trivially unit-testable
 *     and safe to run on the server or the client.
 *   - Never fabricate. Every function that can't produce a statistically
 *     meaningful answer returns `null` (or an empty array) rather than a
 *     misleading number — callers (lib/insights.ts in particular) treat
 *     `null` as "suppress this".
 *   - All calendar bucketing uses the UTC helpers in lib/dateUtils.ts —
 *     the same convention already used by streaks/momentum — so weekly
 *     analytics never disagree with the streak/heatmap UI near midnight.
 *   - Only `transaction_type === 'deposit'` rows count as "savings".
 *     Withdrawals, goal purchases, and balance adjustments are excluded
 *     from every calculation in this file by design (Phase 2 scope is
 *     savings behaviour, not net balance movement).
 */

import type { Transaction } from "@/lib/types";
import { getUTCWeekStartString, getUTCMonthString, utcDaysBetween } from "@/lib/dateUtils";

export type Deposit = Transaction & { transaction_type: "deposit" };

// ─── Goal-level helpers ─────────────────────────────────────────────────────

/**
 * The schema has no `completed_at` column on savings_goals (only the
 * `is_complete` boolean — see lib/types.ts). This approximates a
 * completion date as the timestamp of the most recent transaction on
 * that goal, which is the same proxy lib/timeline.ts already used
 * inline for its "goal completed" journey events.
 *
 * Extracted here (Sprint 24, Phase 8 — Category Intelligence) so
 * timeline.ts and lib/categoryIntelligence.ts share one definition
 * instead of two copies quietly drifting apart, per the "one source of
 * truth for every financial metric" rule this file already follows.
 *
 * Returns the goal's created_at if it has no transactions at all (should
 * be rare — a goal can't legitimately be `is_complete` with zero
 * deposits — but pure functions here never assume the impossible away).
 */
export function getGoalCompletionTimestamp(
  goal: { id: string; created_at: string },
  transactions: Transaction[]
): string {
  const goalTxs = transactions
    .filter((t) => t.goal_id === goal.id)
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return goalTxs[0]?.created_at ?? goal.created_at;
}

// ─── Filtering ──────────────────────────────────────────────────────────────

/** Narrows any transaction list down to real deposits, sorted oldest → newest. */
export function getDeposits(transactions: Transaction[]): Deposit[] {
  return transactions
    .filter((t): t is Deposit => t.transaction_type === "deposit" && Number(t.amount) > 0)
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

// ─── Basic statistics ───────────────────────────────────────────────────────

export interface DepositStats {
  count: number;
  total: number;
  average: number;
  largest: Deposit;
  smallest: Deposit;
}

/** Returns null when there isn't at least one deposit — never fabricates a mean of zero. */
export function getDepositStats(deposits: Deposit[]): DepositStats | null {
  if (deposits.length === 0) return null;
  const total = deposits.reduce((sum, d) => sum + Number(d.amount), 0);
  let largest = deposits[0];
  let smallest = deposits[0];
  for (const d of deposits) {
    if (Number(d.amount) > Number(largest.amount)) largest = d;
    if (Number(d.amount) < Number(smallest.amount)) smallest = d;
  }
  return { count: deposits.length, total, average: total / deposits.length, largest, smallest };
}

// ─── Time-bucketed totals ───────────────────────────────────────────────────

export interface BucketTotal { key: string; total: number; count: number }

/** Buckets deposits into UTC calendar weeks (Monday-start), oldest → newest. */
export function weeklyTotals(deposits: Deposit[]): BucketTotal[] {
  const map = new Map<string, BucketTotal>();
  for (const d of deposits) {
    const key = getUTCWeekStartString(new Date(d.created_at));
    const bucket = map.get(key) ?? { key, total: 0, count: 0 };
    bucket.total += Number(d.amount);
    bucket.count += 1;
    map.set(key, bucket);
  }
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
}

/** Buckets deposits into UTC calendar months, oldest → newest. */
export function monthlyTotals(deposits: Deposit[]): BucketTotal[] {
  const map = new Map<string, BucketTotal>();
  for (const d of deposits) {
    const key = getUTCMonthString(new Date(d.created_at));
    const bucket = map.get(key) ?? { key, total: 0, count: 0 };
    bucket.total += Number(d.amount);
    bucket.count += 1;
    map.set(key, bucket);
  }
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
}

/** Buckets deposits by UTC calendar year, oldest → newest. */
export function yearlyTotals(deposits: Deposit[]): BucketTotal[] {
  const map = new Map<string, BucketTotal>();
  for (const d of deposits) {
    const key = String(new Date(d.created_at).getUTCFullYear());
    const bucket = map.get(key) ?? { key, total: 0, count: 0 };
    bucket.total += Number(d.amount);
    bucket.count += 1;
    map.set(key, bucket);
  }
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
}

// ─── Frequency / day-of-week ────────────────────────────────────────────────

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface DayFrequency { day: string; dayIndex: number; count: number; total: number }

/** Deposit count/total grouped by day of week (UTC), for all 7 days (zero-filled). */
export function depositsByDayOfWeek(deposits: Deposit[]): DayFrequency[] {
  const buckets: DayFrequency[] = DAY_NAMES.map((day, dayIndex) => ({ day, dayIndex, count: 0, total: 0 }));
  for (const d of deposits) {
    const idx = new Date(d.created_at).getUTCDay();
    buckets[idx].count += 1;
    buckets[idx].total += Number(d.amount);
  }
  return buckets;
}

/**
 * The day of week the user deposits on most often. Requires at least
 * `minDeposits` (default 5) total deposits with a clear (non-tied) winner —
 * otherwise returns null rather than asserting a "favourite day" from noise.
 */
export function mostFrequentDay(deposits: Deposit[], minDeposits = 5): DayFrequency | null {
  if (deposits.length < minDeposits) return null;
  const byDay = depositsByDayOfWeek(deposits);
  const sorted = [...byDay].sort((a, b) => b.count - a.count);
  if (sorted[0].count === 0) return null;
  if (sorted[0].count === sorted[1].count) return null; // tie — no clear pattern
  return sorted[0];
}

// ─── Intervals & consistency ────────────────────────────────────────────────

/** Days between each consecutive deposit, oldest → newest. Empty if <2 deposits. */
export function depositIntervalsDays(deposits: Deposit[]): number[] {
  const intervals: number[] = [];
  for (let i = 1; i < deposits.length; i++) {
    intervals.push(utcDaysBetween(new Date(deposits[i - 1].created_at), new Date(deposits[i].created_at)));
  }
  return intervals;
}

export function averageDepositIntervalDays(deposits: Deposit[]): number | null {
  const intervals = depositIntervalsDays(deposits);
  if (intervals.length === 0) return null;
  return intervals.reduce((a, b) => a + b, 0) / intervals.length;
}

/**
 * Consistency score (0–100): how regularly the user deposits, based on the
 * coefficient of variation of the gaps between deposits (lower variance =
 * more consistent). Documented formula:
 *
 *   cv    = stdDev(intervals) / mean(intervals)
 *   score = round(100 * clamp(1 - cv, 0, 1))
 *
 * A user who deposits like clockwork (cv ≈ 0) scores ~100. A user whose
 * gaps are wildly irregular (cv ≥ 1) scores 0. Requires at least 3 deposits
 * (2 intervals) — returns null otherwise, since a single interval can't
 * express "consistency".
 */
export function consistencyScore(deposits: Deposit[]): number | null {
  const intervals = depositIntervalsDays(deposits);
  if (intervals.length < 2) return null;
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  if (mean === 0) return 100; // all deposits landed on the same day — perfectly consistent
  const variance = intervals.reduce((sum, x) => sum + (x - mean) ** 2, 0) / intervals.length;
  const stdDev = Math.sqrt(variance);
  const cv = stdDev / mean;
  return Math.round(100 * Math.min(1, Math.max(0, 1 - cv)));
}

export function averageDepositsPerWeek(deposits: Deposit[]): number | null {
  if (deposits.length === 0) return null;
  const first = new Date(deposits[0].created_at);
  const last = new Date(deposits[deposits.length - 1].created_at);
  const spanDays = Math.max(1, utcDaysBetween(first, last));
  const spanWeeks = Math.max(1 / 7, spanDays / 7);
  return deposits.length / spanWeeks;
}

// ─── Weekly streaks (savings behaviour, independent of app-wide streak) ────

export interface WeeklySavingStreak { current: number; longest: number }

/**
 * Longest / current run of consecutive UTC calendar weeks containing at
 * least one deposit. Distinct from `profile.streak_days` (app-open streak)
 * — this measures actual saving behaviour, which is what Phase 2/6/7 need.
 */
export function weeklySavingStreak(deposits: Deposit[], now: Date = new Date()): WeeklySavingStreak {
  if (deposits.length === 0) return { current: 0, longest: 0 };

  const weekKeys = new Set(deposits.map((d) => getUTCWeekStartString(new Date(d.created_at))));
  const sortedWeeks = Array.from(weekKeys).sort();

  // Longest run of consecutive weeks present in the set.
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sortedWeeks.length; i++) {
    const prevWeekStart = new Date(sortedWeeks[i - 1] + "T00:00:00Z");
    const expectedNext = getUTCWeekStartString(new Date(prevWeekStart.getTime() + 7 * 86400000));
    if (expectedNext === sortedWeeks[i]) {
      run += 1;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
  }

  // Current run: walk backwards from this week (or last week, to allow for
  // "haven't deposited yet this week but did last week") while consecutive.
  const thisWeek = getUTCWeekStartString(now);
  let cursor = weekKeys.has(thisWeek) ? thisWeek : getUTCWeekStartString(new Date(now.getTime() - 7 * 86400000));
  let current = 0;
  while (weekKeys.has(cursor)) {
    current += 1;
    cursor = getUTCWeekStartString(new Date(new Date(cursor + "T00:00:00Z").getTime() - 7 * 86400000));
  }

  return { current, longest };
}

/** Days since the most recent deposit, as of `now`. Null if no deposits yet. */
export function daysSinceLastDeposit(deposits: Deposit[], now: Date = new Date()): number | null {
  if (deposits.length === 0) return null;
  const last = deposits[deposits.length - 1];
  return utcDaysBetween(new Date(last.created_at), now);
}

/** The single longest gap (in days) between two consecutive deposits. Null if <2 deposits. */
export function longestInactivityGapDays(deposits: Deposit[]): number | null {
  const intervals = depositIntervalsDays(deposits);
  if (intervals.length === 0) return null;
  return Math.max(...intervals);
}

// ─── Convenience: full snapshot ─────────────────────────────────────────────

export interface AnalyticsSnapshot {
  stats: DepositStats | null;
  weekly: BucketTotal[];
  monthly: BucketTotal[];
  yearly: BucketTotal[];
  favoriteDay: DayFrequency | null;
  averageIntervalDays: number | null;
  consistency: number | null;
  depositsPerWeek: number | null;
  weeklyStreak: WeeklySavingStreak;
  daysSinceLastDeposit: number | null;
  longestInactivityGapDays: number | null;
}

/** Computes every Phase 2 metric in one pass over a transaction list. */
export function buildAnalyticsSnapshot(transactions: Transaction[], now: Date = new Date()): AnalyticsSnapshot {
  const deposits = getDeposits(transactions);
  return {
    stats: getDepositStats(deposits),
    weekly: weeklyTotals(deposits),
    monthly: monthlyTotals(deposits),
    yearly: yearlyTotals(deposits),
    favoriteDay: mostFrequentDay(deposits),
    averageIntervalDays: averageDepositIntervalDays(deposits),
    consistency: consistencyScore(deposits),
    depositsPerWeek: averageDepositsPerWeek(deposits),
    weeklyStreak: weeklySavingStreak(deposits, now),
    daysSinceLastDeposit: daysSinceLastDeposit(deposits, now),
    longestInactivityGapDays: longestInactivityGapDays(deposits),
  };
}
