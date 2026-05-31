import { differenceInCalendarDays, format } from "date-fns";

export interface StreakEvalResult {
  newStreak: number;
  broken: boolean;
  shieldUsed: boolean;
  message: string;
  milestoneHit?: number;
}

const STREAK_MILESTONES = [3, 7, 14, 21, 30, 45, 66, 90, 100, 180, 365];

export function evaluateStreak(
  lastActiveDateStr: string | null,
  streakDays: number,
  streakShields: number
): StreakEvalResult {
  const today = new Date();
  const todayStr = format(today, "yyyy-MM-dd");

  if (!lastActiveDateStr) {
    return { newStreak: 1, broken: false, shieldUsed: false, message: "Streak started! Day 1 🔥" };
  }

  const lastDate = new Date(lastActiveDateStr);
  const diff = differenceInCalendarDays(today, lastDate);

  if (diff === 0) {
    // Same day — no change
    return { newStreak: streakDays, broken: false, shieldUsed: false, message: "" };
  }

  if (diff === 1) {
    // Consecutive — extend
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
      shieldUsed: false,
      milestoneHit,
      message: messages[newStreak] ?? `Day ${newStreak} streak! Keep going 🔥`,
    };
  }

  if (diff === 2 && streakShields > 0) {
    // Missed 1 day — use a streak shield
    const newStreak = streakDays + 1; // still counts as consecutive
    return {
      newStreak,
      broken: false,
      shieldUsed: true,
      message: `Streak shield used! Your ${streakDays}-day streak is safe 🛡️`,
    };
  }

  // Streak broken
  return {
    newStreak: 1,
    broken: true,
    shieldUsed: false,
    message: `Streak reset. Day 1 — rebuild it 💪`,
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

export function getStreakMessage(days: number): string {
  if (days === 0) return "Start your streak today!";
  if (days < 3)   return "Keep going — 3 days to your first badge!";
  if (days < 7)   return `${7 - days} more days to Week Warrior 🔥`;
  if (days < 21)  return `${21 - days} more days to Habit Former 💎`;
  if (days < 30)  return `${30 - days} more days to Monthly Master 🏆`;
  if (days < 66)  return `${66 - days} more days to Hardwired 🧠`;
  return "You're in elite territory! Keep it up! 👑";
}
