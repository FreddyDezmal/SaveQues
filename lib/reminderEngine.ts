/**
 * lib/reminderEngine.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 27 Phase 3 — Smart Reminder Engine.
 *
 * Pure, DB-free computation for the notification scheduler in
 * lib/notifications.ts. Two responsibilities live here, and only
 * here, so they can be unit-tested without mocking Supabase:
 *
 *   1. "Should this reminder fire?" — threshold checks that keep
 *      the engine from spamming (goal-almost-complete, goal
 *      deadline, missed weekly deposit).
 *   2. "What should it say?" — adaptive copy generation. Sprint 27
 *      explicitly asks for messages built from real numbers
 *      ("You're only R120 away from Level 12") instead of generic
 *      nagging ("Save today!").
 *
 * This module follows the same separation-of-concerns pattern as
 * lib/goalHealth.ts and lib/forecast.ts: callers (notifications.ts)
 * do the Supabase fetching and pass plain snapshots in here.
 *
 * Deliberately NOT handled here (out of scope for Phase 3, tracked
 * as known limitations in docs/SPRINT27_PHASE3_SMART_REMINDERS.md):
 *   - "Subscription renewal" reminders from the sprint brief have no
 *     home in this codebase — SaveQuest has no billing/subscription
 *     concept. Not fabricated.
 *   - Per-goal dedupe (a user with two goals both >=90% funded will
 *     only be reminded about one per window) — notification_logs has
 *     no goal_id column, and adding one is a schema change out of
 *     scope for this phase.
 */

import { formatAmount } from "./currency";
import { utcDaysBetween } from "./dateUtils";
import { renderNotificationTemplate } from "./notificationTemplates";

// ── Snapshots (plain data, no Supabase types) ──────────────────

export interface ReminderGoalSnapshot {
  id: string;
  title: string;
  goalEmoji: string | null;
  targetAmount: number;
  currentAmount: number;
  targetDate: string | null; // "YYYY-MM-DD" or null
  isPrimary: boolean;
}

export interface ReminderLevelSnapshot {
  level: number;
  xpTotal: number;
  currentLevelXP: number;
  nextLevelXP: number;
}

export interface CopyResult {
  title: string;
  body: string;
}

// ── Goal math ───────────────────────────────────────────────────

/** Progress as a 0–1 fraction, clamped, safe against a zero/negative target. */
export function goalProgressFraction(goal: ReminderGoalSnapshot): number {
  if (!goal.targetAmount || goal.targetAmount <= 0) return 0;
  return Math.min(1, Math.max(0, goal.currentAmount / goal.targetAmount));
}

export function goalRemainingAmount(goal: ReminderGoalSnapshot): number {
  return Math.max(0, goal.targetAmount - goal.currentAmount);
}

/** Whole days from `now` to the goal's target date. Null if no deadline set. */
export function goalDaysRemaining(
  goal: ReminderGoalSnapshot,
  now: Date = new Date()
): number | null {
  if (!goal.targetDate) return null;
  const target = new Date(`${goal.targetDate}T00:00:00.000Z`);
  return utcDaysBetween(now, target);
}

/**
 * Picks the single goal to reference in reminder copy, from a user's
 * active (incomplete) goals. Priority: explicit primary goal > nearest
 * deadline > highest progress. Returns null if there are none — callers
 * must fall back to non-goal copy (XP, or generic).
 */
export function pickNearestGoal(
  goals: ReminderGoalSnapshot[],
  now: Date = new Date()
): ReminderGoalSnapshot | null {
  const incomplete = goals.filter((g) => goalProgressFraction(g) < 1);
  if (incomplete.length === 0) return null;

  const primary = incomplete.find((g) => g.isPrimary);
  if (primary) return primary;

  const withDeadline = incomplete
    .filter((g) => g.targetDate)
    .sort((a, b) => (goalDaysRemaining(a, now) ?? Infinity) - (goalDaysRemaining(b, now) ?? Infinity));
  if (withDeadline.length > 0) return withDeadline[0];

  return [...incomplete].sort(
    (a, b) => goalProgressFraction(b) - goalProgressFraction(a)
  )[0];
}

// ── "Should this fire?" thresholds ──────────────────────────────

/** True once a goal is >=90% funded but not yet complete. */
export function shouldSendGoalAlmostComplete(
  goal: ReminderGoalSnapshot,
  thresholdFraction = 0.9
): boolean {
  const pct = goalProgressFraction(goal);
  return pct >= thresholdFraction && pct < 1;
}

/** True when an incomplete goal's deadline is within `maxDays` (including today, excluding overdue). */
export function shouldSendGoalDeadlineApproaching(
  goal: ReminderGoalSnapshot,
  now: Date = new Date(),
  maxDays = 3
): boolean {
  if (goalProgressFraction(goal) >= 1) return false;
  const daysLeft = goalDaysRemaining(goal, now);
  if (daysLeft === null) return false;
  return daysLeft >= 0 && daysLeft <= maxDays;
}

// ── Adaptive copy ───────────────────────────────────────────────
//
// Sprint 27, Phase 7: every string literal that used to live inline in
// these functions now lives in lib/notificationTemplates.ts's registry.
// What stays here is exactly the decision logic the brief's own
// "no hardcoded strings" rule doesn't apply to: WHICH template to pick
// and WHAT numbers to compute for it — never the words themselves.

/**
 * The Phase 3 headline feature: replaces generic "Save today!" nagging
 * with a message built from the user's actual numbers. Prefers a
 * concrete goal-remaining-amount (most actionable), falls back to
 * XP-to-next-level, falls back to a plain generic nudge only when
 * neither signal is available.
 */
export function buildSmartSavingsReminderCopy(ctx: {
  nearestGoal: ReminderGoalSnapshot | null;
  level: ReminderLevelSnapshot | null;
  currencyCode?: string;
}): CopyResult {
  const { nearestGoal, level, currencyCode } = ctx;

  if (nearestGoal) {
    const remaining = goalRemainingAmount(nearestGoal);
    if (remaining > 0) {
      return renderNotificationTemplate("daily_quest_goal", {
        goal_emoji: nearestGoal.goalEmoji ?? "🎯",
        amount: formatAmount(remaining, currencyCode),
        goal_name: nearestGoal.title,
      });
    }
  }

  if (level) {
    const xpToNext = level.nextLevelXP - level.xpTotal;
    const isMaxLevel = level.nextLevelXP <= level.currentLevelXP;
    if (!isMaxLevel && xpToNext > 0) {
      return renderNotificationTemplate("daily_quest_xp", { xp: xpToNext, level: level.level + 1 });
    }
  }

  return renderNotificationTemplate("daily_quest_generic", {});
}

/** Streak-at-risk copy, made concrete with the actual streak length. */
export function buildStreakReminderCopy(streakDays: number): CopyResult {
  return renderNotificationTemplate("streak_at_risk", { days: streakDays });
}

export function buildGoalAlmostCompleteCopy(
  goal: ReminderGoalSnapshot,
  currencyCode?: string
): CopyResult {
  const remaining = goalRemainingAmount(goal);
  const pct = Math.round(goalProgressFraction(goal) * 100);
  return renderNotificationTemplate("goal_almost_complete", {
    goal_emoji: goal.goalEmoji ?? "🎯",
    percent: pct,
    amount: formatAmount(remaining, currencyCode),
    goal_name: goal.title,
  });
}

export function buildGoalDeadlineCopy(
  goal: ReminderGoalSnapshot,
  daysLeft: number,
  currencyCode?: string
): CopyResult {
  const vars = { amount: formatAmount(goalRemainingAmount(goal), currencyCode), goal_name: goal.title, days: daysLeft };
  const key = daysLeft === 0 ? "goal_deadline_today" : daysLeft === 1 ? "goal_deadline_one_day" : "goal_deadline_many_days";
  return renderNotificationTemplate(key, vars);
}

export function buildMissedWeeklyDepositCopy(
  nearestGoal: ReminderGoalSnapshot | null,
  currencyCode?: string
): CopyResult {
  if (nearestGoal) {
    return renderNotificationTemplate("missed_weekly_deposit_with_goal", {
      goal_name: nearestGoal.title,
      amount: formatAmount(goalRemainingAmount(nearestGoal), currencyCode),
    });
  }
  return renderNotificationTemplate("missed_weekly_deposit_generic", {});
}

export function buildGroupQuestEndingCopy(
  groupName: string,
  questTitle: string,
  daysLeft: number
): CopyResult {
  const vars = { group_name: groupName, quest_title: questTitle, days: daysLeft };
  const key = daysLeft <= 0 ? "group_quest_ending_today" : daysLeft === 1 ? "group_quest_ending_one_day" : "group_quest_ending_many_days";
  return renderNotificationTemplate(key, vars);
}

// ── Sprint 27, Phase 4: quiet hours & vacation mode ─────────────────────────
//
// Both pure — no DB access — so the scheduler in lib/notifications.ts just
// fetches the two preference rows' worth of fields and calls in, same
// separation as everything else in this file.

/**
 * True when `localHour` falls inside the user's quiet-hours window.
 * Handles the overnight-wrap case (e.g. 22 → 7) the same way a plain
 * `start <= hour < end` check can't: when start > end, the window spans
 * midnight, so it's "hour >= start OR hour < end" instead of "between".
 */
export function isWithinQuietHours(
  localHour: number,
  quietHoursEnabled: boolean,
  quietHoursStart: number,
  quietHoursEnd: number
): boolean {
  if (!quietHoursEnabled) return false;
  if (quietHoursStart === quietHoursEnd) return false; // zero-width window = never active
  if (quietHoursStart < quietHoursEnd) {
    return localHour >= quietHoursStart && localHour < quietHoursEnd;
  }
  // Overnight wrap, e.g. 22 → 7
  return localHour >= quietHoursStart || localHour < quietHoursEnd;
}

/**
 * True when vacation mode should currently suppress notifications.
 * `vacationUntil`, if set, auto-expires the pause without requiring the
 * user to remember to toggle it back off — `today` and `vacationUntil`
 * are both "YYYY-MM-DD" strings so this is a plain string comparison,
 * consistent with how date strings are compared everywhere else in this
 * codebase (see lib/weeklyQuests.ts, lib/dateUtils.ts).
 */
export function isVacationActive(
  vacationMode: boolean,
  vacationUntil: string | null,
  today: string
): boolean {
  if (!vacationMode) return false;
  if (!vacationUntil) return true; // no end date set — stays on until manually turned off
  return today <= vacationUntil;
}
