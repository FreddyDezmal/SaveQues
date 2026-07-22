/**
 * lib/streaks.ts
 * ─────────────────────────────────────────────────────────────
 * Code review fix: this file used to contain a second, unused
 * implementation of streak state transitions (evaluateStreak,
 * getStreakCalendar, STREAK_MILESTONES, streak-shield constants).
 * The real, authoritative streak logic lives entirely in the
 * update_streak() Postgres RPC (supabase/migrations/021_m2_server_side_streak.sql),
 * which runs server-side with row locking and an ownership guard.
 *
 * The removed TS functions were never called by any route or
 * component — grep confirms zero call sites for evaluateStreak()
 * and getStreakCalendar() outside this file and its own tests.
 * Worse, they had drifted from the SQL version they claimed to
 * mirror: they compared `new Date(lastActiveDateStr)` (parsed as
 * UTC midnight) against `new Date()` (local server time), a
 * mixed-timezone comparison that the SQL version avoids by doing
 * pure DATE arithmetic in Postgres. Keeping dead code that both
 * duplicates and disagrees with production behavior is worse than
 * having no TS copy at all, so it's been deleted rather than fixed
 * in place — see migration 021 for the real implementation.
 *
 * Only the two functions below are actually used (by
 * app/(app)/dashboard/page.tsx and DashboardClient.tsx) and have
 * been kept, with isStreakPaused() switched to the same UTC-date
 * convention as the rest of the app (lib/dateUtils.ts) instead of
 * local server time, for consistency with update_streak()'s use of
 * Postgres CURRENT_DATE (UTC) and with getMomentumState()'s UTC
 * day convention.
 */

import { getUTCDateString } from "./dateUtils";

/**
 * True while a user's streak is on a deliberate pause (e.g. a vacation
 * hold) — mirrors the `streak_paused_until` check inside update_streak().
 */
export function isStreakPaused(streakPausedUntil: string | null | undefined): boolean {
  if (!streakPausedUntil) return false;
  return streakPausedUntil >= getUTCDateString();
}

export function getStreakMessage(days: number, isPaused = false): string {
  if (isPaused) return "Streak paused — enjoy your break, we'll be here when you're back.";
  if (days === 0) return "Start your streak today!";
  if (days < 3)   return "Keep going — 3 days to your first badge!";
  if (days < 7)   return `${7 - days} more day${7 - days === 1 ? "" : "s"} to Week Warrior 🔥`;
  if (days < 21)  return `${21 - days} more day${21 - days === 1 ? "" : "s"} to Habit Former 💎`;
  if (days < 30)  return `${30 - days} more day${30 - days === 1 ? "" : "s"} to Monthly Master 🏆`;
  if (days < 66)  return `${66 - days} more day${66 - days === 1 ? "" : "s"} to Hardwired 🧠`;
  return "You're in elite territory! Keep it up! 👑";
}