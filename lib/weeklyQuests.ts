// lib/weeklyQuests.ts

import { getUTCWeekStartString } from "./dateUtils";

/**
 * Returns the UTC date string ("YYYY-MM-DD") of the Monday that starts
 * the current week.
 *
 * Bug fix (code review): this used to compute the week start from local
 * server time (`d.getDay()`, `d.getDate()`) while `lib/reflection.ts` and
 * `lib/notifications.ts` each carried their own near-identical copy of the
 * same local-time logic. Three independent implementations meant the app
 * could disagree with itself about which day a week starts on right
 * around a UTC day boundary, and any future fix applied to one copy
 * wouldn't reach the other two. All three now delegate to the single
 * UTC-safe helper in dateUtils.ts that the rest of the app (habits,
 * challenges, analytics) already uses for week bucketing.
 */
export function getWeekStart(): string {
  return getUTCWeekStartString(new Date());
}

export function getDaysIntoWeek(): number {
  const day = new Date().getUTCDay();
  return day === 0 ? 6 : day - 1; // 0=Mon, 6=Sun
}

export function getDaysRemainingInWeek(): number {
  return 6 - getDaysIntoWeek();
}