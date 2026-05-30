import { differenceInCalendarDays, parseISO, format } from "date-fns";

export function evaluateStreak(lastActiveDateStr: string | null, streakDays: number): {
  newStreak: number;
  broken: boolean;
  message: string;
} {
  if (!lastActiveDateStr) {
    return { newStreak: 1, broken: false, message: "Streak started! Day 1 🔥" };
  }

  const today = new Date();
  const lastActive = parseISO(lastActiveDateStr);
  const diff = differenceInCalendarDays(today, lastActive);

  if (diff === 0) {
    // Same day — no change
    return { newStreak: streakDays, broken: false, message: "" };
  } else if (diff === 1) {
    // Consecutive day — extend streak
    const newStreak = streakDays + 1;
    const milestones: Record<number, string> = {
      3:  "3-day streak! You're building something real 🔥",
      7:  "7 days straight! A full week! 🏆",
      14: "2-week streak! You're unstoppable 💪",
      21: "21 days — a habit is forming! 🌟",
      30: "30-DAY STREAK! Absolute legend 🎉",
      66: "66 DAYS! Science says this is a habit now! 🧠",
      100: "100 DAYS! You are a Legendary Saver! 👑",
    };
    return {
      newStreak,
      broken: false,
      message: milestones[newStreak] ?? `Day ${newStreak} streak! Keep going 🔥`,
    };
  } else {
    // Streak broken
    return {
      newStreak: 1,
      broken: true,
      message: `Streak reset. Day 1 — let's rebuild it 💪`,
    };
  }
}

export function formatStreakDisplay(days: number): string {
  if (days >= 100) return `${days} 👑`;
  if (days >= 30)  return `${days} 🏆`;
  if (days >= 7)   return `${days} 🔥`;
  return `${days}`;
}

export function getStreakCalendar(activities: string[], days = 30): {
  date: string;
  active: boolean;
  label: string;
}[] {
  const activitySet = new Set(activities);
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = format(d, "yyyy-MM-dd");
    result.push({
      date: dateStr,
      active: activitySet.has(dateStr),
      label: format(d, "MMM d"),
    });
  }
  return result;
}
