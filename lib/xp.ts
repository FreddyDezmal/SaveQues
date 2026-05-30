export const XP_ACTIONS = {
  LOG_SAVING: 50,
  DAILY_CHECKIN: 100,
  CHALLENGE_COMPLETE: 200,
  GOAL_MILESTONE_25: 150,
  GOAL_MILESTONE_50: 250,
  GOAL_MILESTONE_75: 350,
  GOAL_COMPLETE: 1000,
  STREAK_7: 300,
  STREAK_21: 700,
  STREAK_66: 2000,
} as const;

export type XPAction = keyof typeof XP_ACTIONS;

// Level thresholds — quadratic curve that keeps early levels fast
export const LEVELS = [
  { level: 1, xpRequired: 0,     title: "Savings Seedling" },
  { level: 2, xpRequired: 100,   title: "Budget Apprentice" },
  { level: 3, xpRequired: 300,   title: "Coin Collector" },
  { level: 4, xpRequired: 700,   title: "Frugal Fighter" },
  { level: 5, xpRequired: 1400,  title: "Money Mindful" },
  { level: 6, xpRequired: 2500,  title: "Savings Warrior" },
  { level: 7, xpRequired: 4200,  title: "Wealth Builder" },
  { level: 8, xpRequired: 6500,  title: "Financial Sage" },
  { level: 9, xpRequired: 9500,  title: "Quest Champion" },
  { level: 10, xpRequired: 14000, title: "Legendary Saver" },
];

export function getLevelFromXP(xp: number): {
  level: number;
  title: string;
  currentLevelXP: number;
  nextLevelXP: number;
  progressPercent: number;
} {
  let currentLevel = LEVELS[0];
  for (const l of LEVELS) {
    if (xp >= l.xpRequired) currentLevel = l;
  }
  const idx = LEVELS.indexOf(currentLevel);
  const nextLevel = LEVELS[idx + 1] ?? currentLevel;
  const isMax = idx === LEVELS.length - 1;

  const progressPercent = isMax
    ? 100
    : Math.round(
        ((xp - currentLevel.xpRequired) /
          (nextLevel.xpRequired - currentLevel.xpRequired)) *
          100
      );

  return {
    level: currentLevel.level,
    title: currentLevel.title,
    currentLevelXP: currentLevel.xpRequired,
    nextLevelXP: nextLevel.xpRequired,
    progressPercent,
  };
}

export function calculateStreakMultiplier(streakDays: number): number {
  if (streakDays >= 30) return 2.0;
  if (streakDays >= 14) return 1.5;
  if (streakDays >= 7)  return 1.25;
  return 1.0;
}

export function getXPForAction(action: XPAction, streakDays = 0): number {
  const base = XP_ACTIONS[action];
  const multiplier = calculateStreakMultiplier(streakDays);
  return Math.round(base * multiplier);
}
