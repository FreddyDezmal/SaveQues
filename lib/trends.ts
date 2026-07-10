/**
 * lib/trends.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 19 — Phase 2: period-over-period comparisons.
 *
 * Builds on lib/analyticsEngine.ts's deposit filtering. Kept separate from
 * analyticsEngine.ts because these functions are about *comparing* two
 * windows of time, not describing a single one — different shape of
 * question, same underlying data.
 */

import { getDeposits, type Deposit } from "@/lib/analyticsEngine";
import { utcDaysBetween } from "@/lib/dateUtils";
import type { Transaction } from "@/lib/types";

export interface PeriodComparison {
  currentTotal: number;
  previousTotal: number;
  currentCount: number;
  previousCount: number;
  /** null when previousTotal is 0 — a % change against zero is undefined/misleading. */
  percentChange: number | null;
  direction: "up" | "down" | "flat" | "unknown";
}

function inWindow(deposits: Deposit[], start: Date, end: Date): Deposit[] {
  return deposits.filter((d) => {
    const t = new Date(d.created_at).getTime();
    return t >= start.getTime() && t < end.getTime();
  });
}

/**
 * Compares total deposited in the most recent `windowDays` against the
 * `windowDays` immediately before that. Used for "your saving increased by
 * 18% over the last month"-style insights.
 */
export function compareRecentPeriods(
  transactions: Transaction[],
  windowDays = 30,
  now: Date = new Date()
): PeriodComparison {
  const deposits = getDeposits(transactions);
  const currentEnd = now;
  const currentStart = new Date(now.getTime() - windowDays * 86400000);
  const previousEnd = currentStart;
  const previousStart = new Date(currentStart.getTime() - windowDays * 86400000);

  const current = inWindow(deposits, currentStart, currentEnd);
  const previous = inWindow(deposits, previousStart, previousEnd);

  const currentTotal = current.reduce((s, d) => s + Number(d.amount), 0);
  const previousTotal = previous.reduce((s, d) => s + Number(d.amount), 0);

  const percentChange = previousTotal === 0 ? null : ((currentTotal - previousTotal) / previousTotal) * 100;

  let direction: PeriodComparison["direction"] = "unknown";
  if (percentChange !== null) {
    if (percentChange > 1) direction = "up";
    else if (percentChange < -1) direction = "down";
    else direction = "flat";
  }

  return {
    currentTotal,
    previousTotal,
    currentCount: current.length,
    previousCount: previous.length,
    percentChange,
    direction,
  };
}

export interface MonthStrength { monthKey: string; total: number }

/**
 * Finds the strongest (highest-total) calendar month, and reports whether
 * the *current* month is currently that strongest month. Only considers
 * months with at least one deposit. Returns null with <1 month of data.
 */
export function strongestMonth(
  transactions: Transaction[],
  now: Date = new Date()
): { strongest: MonthStrength; isCurrentMonthStrongest: boolean } | null {
  const deposits = getDeposits(transactions);
  if (deposits.length === 0) return null;

  const map = new Map<string, number>();
  for (const d of deposits) {
    const dt = new Date(d.created_at);
    const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
    map.set(key, (map.get(key) ?? 0) + Number(d.amount));
  }

  let strongest: MonthStrength = { monthKey: "", total: -1 };
  for (const [monthKey, total] of map.entries()) {
    if (total > strongest.total) strongest = { monthKey, total };
  }

  const currentKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return { strongest, isCurrentMonthStrongest: strongest.monthKey === currentKey };
}

/**
 * Compares this week's deposit count/average against last week's, for the
 * "you're saving more consistently than last week" family of insights.
 * Requires deposits in both weeks to avoid a misleading comparison against
 * zero — returns null otherwise.
 */
export function weekOverWeekConsistency(
  transactions: Transaction[],
  now: Date = new Date()
): { thisWeekCount: number; lastWeekCount: number; improved: boolean } | null {
  const deposits = getDeposits(transactions);
  const thisWeekStart = new Date(now.getTime() - 7 * 86400000);
  const lastWeekStart = new Date(now.getTime() - 14 * 86400000);

  const thisWeek = inWindow(deposits, thisWeekStart, now);
  const lastWeek = inWindow(deposits, lastWeekStart, thisWeekStart);

  if (lastWeek.length === 0) return null; // nothing to compare against

  return {
    thisWeekCount: thisWeek.length,
    lastWeekCount: lastWeek.length,
    improved: thisWeek.length > lastWeek.length,
  };
}

/** Age in days of the oldest deposit — used to gate insights that need real history. */
export function historyLengthDays(transactions: Transaction[], now: Date = new Date()): number {
  const deposits = getDeposits(transactions);
  if (deposits.length === 0) return 0;
  return utcDaysBetween(new Date(deposits[0].created_at), now);
}
