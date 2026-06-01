import { differenceInCalendarDays, format, addDays } from "date-fns";

export interface StreakEvalResult {
  newStreak: number;
  broken: boolean;
  graceDayUsed: boolean;
  paused: boolean;
  message: string;
  milestoneHit?: number;
}

export const STREAK_PAUSE_DAYS = 7;
export const GRACE_DAY_LABEL = "grace day";

export function getPauseExpiryDate(pauseStartedAt: string): string {
  return format(addDays(new Date(pauseStartedAt), STREAK_PAUSE_DAYS), "yyyy-MM-dd");
}

export function isStreakPaused(streakPausedUntil: string | null | undefined): boolean {
  if (!streakPausedUntil) return false;
  const today = format(new Date(), "yyyy-MM-dd");
  return streakPausedUntil >= today;
}

const STREAK_MILESTONES = [3, 7, 14, 21, 30, 45, 66, 90, 100, 180, 365];

export function evaluateStreak(
  lastActiveDateStr: string | null,
  streakDays: number,
  streakShields: number,
  streakPausedUntil?: string | null
): StreakEvalResult {
  const today = new Date();

  if (isStreakPaused(streakPausedUntil)) {
    return {
      newStreak: streakDays,
      broken: false,
      graceDayUsed: false,
      paused: true,
      message: `Streak paused — resumes ${streakPausedUntil}`,
    };
  }

  if (!lastActiveDateStr) {
    return { newStreak: 1, broken: false, graceDayUsed: false, paused: false, message: "Streak started! Day 1 🔥" };
  }

  const lastDate = new Date(lastActiveDateStr);
  const diff = differenceInCalendarDays(today, lastDate);

  if (diff === 0) {
    return { newStreak: streakDays, broken: false, graceDayUsed: false, paused: false, message: "" };
  }

  if (diff === 1) {
    const newStreak = streakDays + 1;
    const milestoneHit = STREAK_MILESTONES.includes(newStreak) ? newStreak : undefined;
    const messages: Record<number, string> = {
      3:   "3-day streak! You're building something 🔥",
      7:   "7 days straight! Week Warrior unlocked 🏆",
      14:  "14 days! Fortnight Force achieved ⚡",
      21:  "21 days — habits are forming! 💎",
      30:  "30-DAY STREAK! Monthly Master! 🎉",
      45:  "45 days! Relentless! 🛡️",
      66:  "66 DAYS! Science says it's a habit now 🧠",
      90:  "90 days! Quarter Century reached! 🌟",
      100: "100 DAYS! Century Saver! You're legendary 👑",
    };
    return {
      newStreak,
      broken: false,
      graceDayUsed: false,
      paused: false,
      milestoneHit,
      message: messages[newStreak] ?? `Day ${newStreak} streak! Keep going 🔥`,
    };
  }

  if (diff === 2 && streakShields > 0) {
    const newStreak = streakDays + 1;
    return {
      newStreak,
      broken: false,
      graceDayUsed: true,
      paused: false,
      message: `Grace day used — your ${streakDays}-day streak continues 🛡️`,
    };
  }

  return {
    newStreak: 1,
    broken: true,
    graceDayUsed: false,
    paused: false,
    message: "Day 1 again. You know what to do. 💪",
  };
}

export function formatStreakDisplay(days: number): string {
  if (days >= 100) return `${days} 👑`;
  if (days >= 66)  return `${days} 🧠`;
  if (days >= 30)  return `${days} 🏆`;
  if (days >= 7)   return `${days} 🔥`;
  return `${days}`;
}

export function getStreakCalendar(
  activities: string[],
  days = 30
): { date: string; active: boolean; label: string }[] {
  const activitySet = new Set(activities);
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = format(d, "yyyy-MM-dd");
    result.push({ date: dateStr, active: activitySet.has(dateStr), label: format(d, "MMM d") });
  }
  return result;
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