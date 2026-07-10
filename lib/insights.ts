/**
 * lib/insights.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 19 — Phase 3: Financial Insights.
 *
 * Turns lib/analyticsEngine.ts + lib/trends.ts output into short,
 * human-readable statements. Every insight here is a direct, literal
 * restatement of a calculated number — nothing is inferred, guessed, or
 * phrased more strongly than the data supports.
 *
 * Confidence gating: each generator function has a documented minimum data
 * requirement (see comments). If the requirement isn't met, the function
 * returns null and the insight is silently omitted — never replaced with a
 * vague or speculative placeholder.
 */

import {
  buildAnalyticsSnapshot,
  getDeposits,
  type AnalyticsSnapshot,
} from "@/lib/analyticsEngine";
import { compareRecentPeriods, strongestMonth, weekOverWeekConsistency } from "@/lib/trends";
import { formatCurrency } from "@/lib/utils";
import type { Transaction } from "@/lib/types";

export type InsightType =
  | "favorite_day"
  | "trend_change"
  | "weekly_streak"
  | "strongest_month"
  | "average_deposit"
  | "consistency_improved";

export interface Insight {
  id: string;
  type: InsightType;
  message: string;
  /** 0–1. Purely informational for callers that want to sort/filter further. */
  confidence: number;
}

interface InsightContext {
  snapshot: AnalyticsSnapshot;
  transactions: Transaction[];
  currencyCode: string;
  locale: string;
  now: Date;
}

function money(ctx: InsightContext, amount: number): string {
  return formatCurrency(amount, ctx.currencyCode, ctx.locale);
}

// ─── Individual generators ──────────────────────────────────────────────────
// Each returns Insight | null. Ordering below is also priority ordering.

function favoriteDayInsight(ctx: InsightContext): Insight | null {
  const day = ctx.snapshot.favoriteDay;
  if (!day) return null;
  return {
    id: "favorite_day",
    type: "favorite_day",
    message: `You save most frequently on ${day.day}s.`,
    confidence: Math.min(1, day.count / 10),
  };
}

// Requires at least 30 days of history and at least one deposit in both the
// current and previous 30-day windows, otherwise a % change is either
// undefined or compares against a mostly-empty period.
function trendChangeInsight(ctx: InsightContext): Insight | null {
  const cmp = compareRecentPeriods(ctx.transactions, 30, ctx.now);
  if (cmp.percentChange === null || cmp.previousCount === 0 || cmp.currentCount === 0) return null;
  const pct = Math.round(Math.abs(cmp.percentChange));
  if (pct < 5) return null; // not a meaningful change — avoid noisy "increased by 1%" insights
  const verb = cmp.direction === "up" ? "increased" : "decreased";
  return {
    id: "trend_change",
    type: "trend_change",
    message: `Your average saving amount has ${verb} by ${pct}% over the last month.`,
    confidence: Math.min(1, (cmp.currentCount + cmp.previousCount) / 10),
  };
}

function weeklyStreakInsight(ctx: InsightContext): Insight | null {
  const { current, longest } = ctx.snapshot.weeklyStreak;
  if (current < 2) return null; // "streak" needs at least 2 consecutive weeks to say anything
  const isLongest = current >= longest;
  const label = isLongest
    ? `You've maintained your longest streak for ${current} consecutive weeks.`
    : `You're on a ${current}-week saving streak (your best is ${longest} weeks).`;
  return { id: "weekly_streak", type: "weekly_streak", message: label, confidence: 1 };
}

function strongestMonthInsight(ctx: InsightContext): Insight | null {
  const result = strongestMonth(ctx.transactions, ctx.now);
  if (!result || !result.isCurrentMonthStrongest) return null;
  // Only surface this when there's more than one month of data — otherwise
  // "your strongest month" is trivially true and not an insight.
  if (ctx.snapshot.monthly.length < 2) return null;
  return {
    id: "strongest_month",
    type: "strongest_month",
    message: "This month is currently your strongest saving month.",
    confidence: 0.9,
  };
}

// Requires at least 3 deposits — an average of 1-2 numbers isn't informative.
function averageDepositInsight(ctx: InsightContext): Insight | null {
  const stats = ctx.snapshot.stats;
  if (!stats || stats.count < 3) return null;
  return {
    id: "average_deposit",
    type: "average_deposit",
    message: `Your average deposit is ${money(ctx, stats.average)}.`,
    confidence: Math.min(1, stats.count / 10),
  };
}

function consistencyImprovedInsight(ctx: InsightContext): Insight | null {
  const wow = weekOverWeekConsistency(ctx.transactions, ctx.now);
  if (!wow || !wow.improved) return null;
  return {
    id: "consistency_improved",
    type: "consistency_improved",
    message: "You're saving more consistently than last week.",
    confidence: 0.8,
  };
}

const GENERATORS: ((ctx: InsightContext) => Insight | null)[] = [
  weeklyStreakInsight,
  strongestMonthInsight,
  trendChangeInsight,
  favoriteDayInsight,
  consistencyImprovedInsight,
  averageDepositInsight,
];

/**
 * Generates the full set of currently-supportable insights for a user, most
 * relevant first. Callers (dashboard, weekly review) typically show the top
 * 2-3. Returns an empty array — never a fabricated placeholder — when there
 * isn't enough data.
 */
export function generateInsights(
  transactions: Transaction[],
  options?: { currencyCode?: string; locale?: string; now?: Date }
): Insight[] {
  const now = options?.now ?? new Date();
  const ctx: InsightContext = {
    snapshot: buildAnalyticsSnapshot(transactions, now),
    transactions,
    currencyCode: options?.currencyCode ?? "ZAR",
    locale: options?.locale ?? "en-ZA",
    now,
  };

  // Minimum bar for generating *any* insight: at least 1 real deposit.
  if (getDeposits(transactions).length === 0) return [];

  return GENERATORS.map((fn) => fn(ctx)).filter((i): i is Insight => i !== null);
}
