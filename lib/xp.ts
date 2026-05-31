// ============================================================
// SaveQuest XP & Leveling System — 50-level progression
// ============================================================

export const XP_ACTIONS = {
  LOG_SAVING: 50,
  DAILY_CHECKIN: 100,
  DAILY_QUEST_COMPLETE: 75,
  WEEKLY_QUEST_COMPLETE: 300,
  CHALLENGE_COMPLETE: 200,
  QUEST_CHAIN_STEP: 150,
  QUEST_CHAIN_COMPLETE: 500,
  GOAL_MILESTONE_25: 150,
  GOAL_MILESTONE_50: 250,
  GOAL_MILESTONE_75: 350,
  GOAL_COMPLETE: 1000,
  STREAK_7: 300,
  STREAK_21: 700,
  STREAK_30: 1000,
  STREAK_66: 2000,
  STREAK_100: 5000,
  STREAK_REVIVE: 25,           // consolation XP on streak break
} as const;

export type XPAction = keyof typeof XP_ACTIONS;

// ============================================================
// 50-level progression — fast early, satisfying mid, epic late
// Formula: xp = floor(50 * level^2.2)  tweaked per tier
// ============================================================
export const LEVELS = [
  // Tier 1 — Beginner (1–10): very fast, hooks user
  { level: 1,  xpRequired: 0,      title: "Savings Seedling",      tier: "beginner"     },
  { level: 2,  xpRequired: 120,    title: "Coin Keeper",            tier: "beginner"     },
  { level: 3,  xpRequired: 300,    title: "Penny Pincher",          tier: "beginner"     },
  { level: 4,  xpRequired: 560,    title: "Budget Scout",           tier: "beginner"     },
  { level: 5,  xpRequired: 900,    title: "Budget Explorer",        tier: "beginner"     },
  { level: 6,  xpRequired: 1350,   title: "Frugal Apprentice",      tier: "beginner"     },
  { level: 7,  xpRequired: 1900,   title: "Frugal Fighter",         tier: "beginner"     },
  { level: 8,  xpRequired: 2600,   title: "Savings Scout",          tier: "beginner"     },
  { level: 9,  xpRequired: 3400,   title: "Money Mindful",          tier: "beginner"     },
  { level: 10, xpRequired: 4400,   title: "Coin Collector",         tier: "beginner"     },

  // Tier 2 — Apprentice (11–20): building identity
  { level: 11, xpRequired: 5600,   title: "Thrift Disciple",        tier: "apprentice"   },
  { level: 12, xpRequired: 7000,   title: "Savings Adept",          tier: "apprentice"   },
  { level: 13, xpRequired: 8700,   title: "Budget Tactician",       tier: "apprentice"   },
  { level: 14, xpRequired: 10700,  title: "Frugal Tactician",       tier: "apprentice"   },
  { level: 15, xpRequired: 13000,  title: "Habit Forger",           tier: "apprentice"   },
  { level: 16, xpRequired: 15600,  title: "Wealth Seeker",          tier: "apprentice"   },
  { level: 17, xpRequired: 18600,  title: "Savings Warrior",        tier: "apprentice"   },
  { level: 18, xpRequired: 22000,  title: "Quest Hunter",           tier: "apprentice"   },
  { level: 19, xpRequired: 25800,  title: "Discipline Adept",       tier: "apprentice"   },
  { level: 20, xpRequired: 30000,  title: "Financial Adventurer",   tier: "apprentice"   },

  // Tier 3 — Journeyman (21–30): real commitment
  { level: 21, xpRequired: 35000,  title: "Wealth Journeyman",      tier: "journeyman"   },
  { level: 22, xpRequired: 40500,  title: "Savings Knight",         tier: "journeyman"   },
  { level: 23, xpRequired: 46500,  title: "Budget Knight",          tier: "journeyman"   },
  { level: 24, xpRequired: 53000,  title: "Thrift Champion",        tier: "journeyman"   },
  { level: 25, xpRequired: 60000,  title: "Milestone Master",       tier: "journeyman"   },
  { level: 26, xpRequired: 67500,  title: "Compound Saver",         tier: "journeyman"   },
  { level: 27, xpRequired: 75500,  title: "Wealth Forger",          tier: "journeyman"   },
  { level: 28, xpRequired: 84000,  title: "Savings Paladin",        tier: "journeyman"   },
  { level: 29, xpRequired: 93000,  title: "Quest Veteran",          tier: "journeyman"   },
  { level: 30, xpRequired: 102500, title: "Wealth Builder",         tier: "journeyman"   },

  // Tier 4 — Expert (31–40): elite status
  { level: 31, xpRequired: 113000, title: "Financial Sage",         tier: "expert"       },
  { level: 32, xpRequired: 124000, title: "Savings Sage",           tier: "expert"       },
  { level: 33, xpRequired: 136000, title: "Discipline Sage",        tier: "expert"       },
  { level: 34, xpRequired: 149000, title: "Wealth Tactician",       tier: "expert"       },
  { level: 35, xpRequired: 163000, title: "Quest Champion",         tier: "expert"       },
  { level: 36, xpRequired: 178000, title: "Frugal Master",          tier: "expert"       },
  { level: 37, xpRequired: 194000, title: "Budget Master",          tier: "expert"       },
  { level: 38, xpRequired: 211000, title: "Savings Grandmaster",    tier: "expert"       },
  { level: 39, xpRequired: 229000, title: "Wealth Oracle",          tier: "expert"       },
  { level: 40, xpRequired: 248000, title: "Financial Champion",     tier: "expert"       },

  // Tier 5 — Legend (41–50): mythic prestige
  { level: 41, xpRequired: 268000, title: "Savings Archon",         tier: "legend"       },
  { level: 42, xpRequired: 289000, title: "Thrift Legend",          tier: "legend"       },
  { level: 43, xpRequired: 311000, title: "Budget Legend",          tier: "legend"       },
  { level: 44, xpRequired: 334000, title: "Wealth Legend",          tier: "legend"       },
  { level: 45, xpRequired: 358000, title: "Quest Legend",           tier: "legend"       },
  { level: 46, xpRequired: 383000, title: "Savings Mythic",         tier: "legend"       },
  { level: 47, xpRequired: 409000, title: "Wealth Mythic",          tier: "legend"       },
  { level: 48, xpRequired: 436000, title: "Financial Deity",        tier: "legend"       },
  { level: 49, xpRequired: 464000, title: "Savings Immortal",       tier: "legend"       },
  { level: 50, xpRequired: 493000, title: "Legendary Saver",        tier: "legend"       },
] as const;

export type LevelTier = "beginner" | "apprentice" | "journeyman" | "expert" | "legend";

export const TIER_COLORS: Record<LevelTier, string> = {
  beginner:   "#6b7280", // gray
  apprentice: "#3b82f6", // blue
  journeyman: "#8b5cf6", // purple
  expert:     "#f59e0b", // amber
  legend:     "#ef4444", // red/gold
};

export const TIER_LABELS: Record<LevelTier, string> = {
  beginner:   "Beginner",
  apprentice: "Apprentice",
  journeyman: "Journeyman",
  expert:     "Expert",
  legend:     "Legend",
};

export function getLevelFromXP(xp: number): {
  level: number;
  title: string;
  tier: LevelTier;
  tierColor: string;
  currentLevelXP: number;
  nextLevelXP: number;
  progressPercent: number;
} {
  let currentLevel: typeof LEVELS[number] = LEVELS[0];
  for (const l of LEVELS) {
    if (xp >= l.xpRequired) currentLevel = l;
  }
  const idx = LEVELS.indexOf(currentLevel as any);
  const nextLevel = LEVELS[Math.min(idx + 1, LEVELS.length - 1)];
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
    tier: currentLevel.tier as LevelTier,
    tierColor: TIER_COLORS[currentLevel.tier as LevelTier],
    currentLevelXP: currentLevel.xpRequired,
    nextLevelXP: nextLevel.xpRequired,
    progressPercent,
  };
}

export function calculateStreakMultiplier(streakDays: number): number {
  if (streakDays >= 66) return 3.0;
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

export function getStreakMultiplierLabel(streakDays: number): string {
  if (streakDays >= 66) return "3× Streak Bonus!";
  if (streakDays >= 30) return "2× Streak Bonus!";
  if (streakDays >= 14) return "1.5× Streak Bonus";
  if (streakDays >= 7)  return "1.25× Streak Bonus";
  return "";
}
