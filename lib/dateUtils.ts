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
