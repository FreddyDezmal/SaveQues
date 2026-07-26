/**
 * lib/digest.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 27 Phase 5 — Digest System.
 *
 * Pure, DB-free computation for weekly/monthly digest generation, same
 * separation-of-concerns pattern as lib/reminderEngine.ts (Phase 3) and
 * lib/goalHealth.ts before it: lib/notifications.ts does the Supabase
 * fetching, this module turns raw rows into digest data and push copy.
 *
 * Deliberately reuses rather than reinvents:
 *   - lib/momentum.ts's getMomentumState() for the monthly digest's
 *     "momentum score" — this app already has a momentum concept with its
 *     own carefully-tuned 14-day recency-weighted algorithm (see that
 *     file's own docstring). Building a second, different momentum
 *     calculation for the digest would give users two disagreeing
 *     numbers for what sounds like the same thing.
 *   - lib/dateUtils.ts's getUTCWeekStartString() for grouping daily
 *     points into weeks (best/worst week) — same Monday-start convention
 *     every other weekly grouping in this codebase already uses.
 *   - lib/reminderEngine.ts's goal snapshot/selection shape for "closest
 *     goal" — the weekly digest's closest-goal field is built by the
 *     caller using pickNearestGoal()/goalRemainingAmount() from that
 *     module rather than a third goal-selection implementation.
 */

import { formatAmount } from "./currency";
import { getUTCWeekStartString } from "./dateUtils";
import { getMomentumState, type MomentumInfo } from "./momentum";
import { renderNotificationTemplate } from "./notificationTemplates";

export interface CopyResult {
  title: string;
  body: string;
}

export interface DailyPoint {
  date: string; // "YYYY-MM-DD"
  value: number;
}

export interface WeekTotal {
  weekStart: string; // "YYYY-MM-DD", Monday
  total: number;
}

export interface WeeklyDigestData {
  periodStart: string;
  periodEnd: string;
  totalSaved: number;
  questsCompleted: number;
  xpEarned: number;
  level: number;
  streakDays: number;
  closestGoal: { title: string; remaining: number } | null;
}

export interface MonthlyDigestData {
  periodStart: string;
  periodEnd: string;
  totalSaved: number;
  xpEarned: number;
  questsCompleted: number;
  achievements: { id: string; title: string; icon: string }[];
  dailySavings: DailyPoint[];
  dailyXP: DailyPoint[];
  bestWeek: WeekTotal | null;
  worstWeek: WeekTotal | null;
  momentum: MomentumInfo;
}

// ── Weekly grouping ──────────────────────────────────────────────

/**
 * Groups a series of daily points into Monday-start weekly totals.
 * Used for the monthly digest's "best week / worst week" — a genuinely
 * empty input returns an empty array, not a fabricated zero week.
 */
export function groupDailyIntoWeeks(daily: DailyPoint[]): WeekTotal[] {
  const totals = new Map<string, number>();
  for (const point of daily) {
    const weekStart = getUTCWeekStartString(new Date(`${point.date}T00:00:00.000Z`));
    totals.set(weekStart, (totals.get(weekStart) ?? 0) + point.value);
  }
  return Array.from(totals.entries())
    .map(([weekStart, total]) => ({ weekStart, total }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

/**
 * Picks the highest- and lowest-total weeks from a set of weekly totals.
 * With fewer than 2 distinct weeks, best and worst legitimately end up
 * being the same week (or both null with zero weeks) — not a bug, just
 * not enough data yet to contrast.
 */
export function findBestAndWorstWeek(weeks: WeekTotal[]): { best: WeekTotal | null; worst: WeekTotal | null } {
  if (weeks.length === 0) return { best: null, worst: null };
  let best = weeks[0];
  let worst = weeks[0];
  for (const w of weeks) {
    if (w.total > best.total) best = w;
    if (w.total < worst.total) worst = w;
  }
  return { best, worst };
}

// ── Push copy ────────────────────────────────────────────────────
//
// These are deliberately SHORT — a highlight, not the full recap. The
// full breakdown (everything the sprint brief's examples list) lives in
// the persisted user_digests row and is rendered on the /digest/[id]
// page the notification deep-links to, not crammed into a push body.

export function buildWeeklyDigestPushCopy(data: WeeklyDigestData, currencyCode?: string): CopyResult {
  return renderNotificationTemplate("weekly_summary", {
    amount: formatAmount(data.totalSaved, currencyCode),
    quests: data.questsCompleted,
    quest_word: data.questsCompleted === 1 ? "quest" : "quests",
    xp: data.xpEarned,
  });
}

export function buildMonthlyDigestPushCopy(data: MonthlyDigestData, currencyCode?: string): CopyResult {
  return renderNotificationTemplate("monthly_summary", {
    amount: formatAmount(data.totalSaved, currencyCode),
    momentum_label: data.momentum.label,
  });
}
