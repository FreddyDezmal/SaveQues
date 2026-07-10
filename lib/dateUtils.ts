/**
 * lib/dateUtils.ts
 * ─────────────────────────────────────────────────────────────
 * Single source of truth for "what calendar date is it right now,
 * for activity-tracking purposes".
 *
 * Day Momentum bug (root cause #4): activity_log rows were written
 * using Postgres CURRENT_DATE (UTC, server-side) while the
 * MomentumHeatmap UI computed "today" using date-fns `format()` on
 * the *browser's local time* (client component), and
 * getMomentumState() computed its 14-day window using
 * `toISOString()` (UTC). Near local midnight these three clocks can
 * disagree about which calendar day "today" is, causing activity to
 * appear on the wrong cell or to vanish from the heatmap entirely.
 *
 * Fix: standardise EVERY "today" computation used for activity_log
 * reads/writes — server routes, RPC calls, and client components —
 * on UTC via this single helper. All date-keyed activity data
 * (activity_log.activity_date, daily_quest_logs.quest_date, the
 * MomentumHeatmap day grid, getMomentumState's day list) must use
 * getUTCDateString() so writers and readers always agree.
 */

/**
 * Returns the UTC calendar date for `date` (defaults to now) as a
 * "YYYY-MM-DD" string. Equivalent to `date.toISOString().split("T")[0]`
 * but named for intent and centralised so it's easy to audit/replace.
 */
export function getUTCDateString(date: Date = new Date()): string {
  return date.toISOString().split("T")[0];
}

/**
 * Returns an array of the last `days` UTC date strings, oldest first,
 * ending with today (UTC). e.g. last(3) -> ["2026-06-12","2026-06-13","2026-06-14"]
 */
export function getLastNUTCDateStrings(days: number, from: Date = new Date()): string[] {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(from);
    d.setUTCDate(d.getUTCDate() - (days - 1 - i));
    return getUTCDateString(d);
  });
}

/**
 * Sprint 19 — added for the analytics/insights engine (lib/analyticsEngine.ts),
 * which needs to bucket deposits into calendar weeks. Reuses the same UTC
 * convention as the rest of this file so weekly buckets never disagree with
 * activity_log-based streak/momentum calculations near a local midnight.
 *
 * Returns the UTC date string ("YYYY-MM-DD") of the Monday that starts the
 * week containing `date`.
 */
export function getUTCWeekStartString(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sunday ... 6 = Saturday
  const diffToMonday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  return getUTCDateString(d);
}

/** Sprint 19 — UTC "YYYY-MM" month bucket key, same convention as above. */
export function getUTCMonthString(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Whole calendar days (UTC) between two dates. Positive when `b` is after `a`. */
export function utcDaysBetween(a: Date, b: Date): number {
  const MS_PER_DAY = 86400000;
  const aUTC = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const bUTC = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((bUTC - aUTC) / MS_PER_DAY);
}
