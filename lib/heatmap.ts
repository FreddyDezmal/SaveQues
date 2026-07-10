/**
 * lib/heatmap.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 20 — Phase 7: Savings Heatmap.
 *
 * UI-independent: produces a plain array of {date, level, amount} cells a
 * GitHub-style calendar component can render however it likes (this sprint
 * doesn't add that component — see docs/SPRINT20_PERSONALIZATION.md for
 * the follow-up UI task). Levels are computed from the user's own
 * distribution of daily deposit totals via quantile thresholds, not a
 * fixed currency amount — a user who saves R20/day and one who saves
 * R2000/day both get a meaningfully-colored heatmap.
 */

import { getDeposits } from "@/lib/analyticsEngine";
import { getUTCDateString, getLastNUTCDateStrings } from "@/lib/dateUtils";
import type { Transaction } from "@/lib/types";

export type HeatmapLevel = 0 | 1 | 2 | 3 | 4; // none, low, medium, high, very high

export interface HeatmapCell {
  date: string; // UTC "YYYY-MM-DD"
  amount: number;
  level: HeatmapLevel;
}

export type HeatmapRange = "month" | "quarter" | "year";

const RANGE_DAYS: Record<HeatmapRange, number> = { month: 30, quarter: 90, year: 365 };

/**
 * Quantile-based thresholds computed from the user's own active days (days
 * with at least one deposit) within the requested range — so "high
 * activity" always means "high for this user," never an arbitrary fixed
 * currency figure. Falls back to a simple max-ratio ladder when there are
 * fewer than 4 active days to derive quantiles from.
 */
function computeLevel(amount: number, sortedActiveAmounts: number[]): HeatmapLevel {
  if (amount <= 0) return 0;
  if (sortedActiveAmounts.length < 4) {
    const max = sortedActiveAmounts[sortedActiveAmounts.length - 1] ?? amount;
    const ratio = amount / max;
    if (ratio >= 1) return 4;
    if (ratio >= 0.66) return 3;
    if (ratio >= 0.33) return 2;
    return 1;
  }
  const q = (p: number) => sortedActiveAmounts[Math.min(sortedActiveAmounts.length - 1, Math.floor(p * sortedActiveAmounts.length))];
  const q25 = q(0.25);
  const q50 = q(0.5);
  const q75 = q(0.75);
  if (amount >= q75) return 4;
  if (amount >= q50) return 3;
  if (amount >= q25) return 2;
  return 1;
}

export function buildSavingsHeatmap(
  transactions: Transaction[],
  range: HeatmapRange = "month",
  now: Date = new Date()
): HeatmapCell[] {
  const days = RANGE_DAYS[range];
  const dateStrings = getLastNUTCDateStrings(days, now);

  const deposits = getDeposits(transactions);
  const byDay = new Map<string, number>();
  for (const d of deposits) {
    const key = getUTCDateString(new Date(d.created_at));
    byDay.set(key, (byDay.get(key) ?? 0) + Number(d.amount));
  }

  const sortedActiveAmounts = Array.from(byDay.values())
    .filter((a) => a > 0)
    .sort((a, b) => a - b);

  return dateStrings.map((date) => {
    const amount = byDay.get(date) ?? 0;
    return { date, amount, level: computeLevel(amount, sortedActiveAmounts) };
  });
}

/** Convenience summary alongside the cell grid — active days, total, and best day in range. */
export function summarizeHeatmap(cells: HeatmapCell[]): { activeDays: number; totalDays: number; total: number; bestDay: HeatmapCell | null } {
  const active = cells.filter((c) => c.amount > 0);
  const total = active.reduce((s, c) => s + c.amount, 0);
  const bestDay = active.reduce<HeatmapCell | null>((best, c) => (!best || c.amount > best.amount ? c : best), null);
  return { activeDays: active.length, totalDays: cells.length, total, bestDay };
}
