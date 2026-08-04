// ============================================================
// SaveQuest Achievement Catalog — 65 achievements
// (60 through Sprint 18/20 + 5 progressive deposit-count tiers, Sprint 21)
// ============================================================

import { formatAmount, DEFAULT_CURRENCY, DEFAULT_LOCALE } from "@/lib/currency";

export interface Achievement {
  id: string;
  title: string;
  description: string;
  category: "streak" | "savings" | "quest" | "social" | "special" | "hidden";
  icon: string;
  xpReward: number;
  secret?: boolean;
  /**
   * Optional explicit "how to unlock" text shown in the badge detail
   * panel. Falls back to `description` via getUnlockCriteria() when not
   * set — most existing descriptions already read as unlock criteria
   * (e.g. "7-day streak", "Total saved: R500"). Use this field when a
   * badge's flavor description differs from the precise requirement.
   */
  unlockCriteria?: string;
}

/**
 * Returns the user-facing "how to unlock" text for an achievement.
 * Used by the badge detail panel (Task 2). Prefers the explicit
 * `unlockCriteria` field; falls back to `description` since most
 * existing achievement descriptions already describe the requirement.
 */
export function getUnlockCriteria(achievement: Pick<Achievement, "unlockCriteria" | "description">): string {
  return achievement.unlockCriteria ?? achievement.description;
}

export const ACHIEVEMENTS: Achievement[] = [

  // ── STREAK (12) ──────────────────────────────────────────
  { id: "streak_1",    title: "First Flame",        description: "First day active",                        category: "streak",  icon: "🕯️",  xpReward: 25   },
  { id: "streak_3",    title: "On a Roll",           description: "3-day streak",                           category: "streak",  icon: "🔥",  xpReward: 100  },
  { id: "streak_7",    title: "Week Warrior",        description: "7-day streak",                           category: "streak",  icon: "⚡",  xpReward: 300  },
  { id: "streak_14",   title: "Fortnight Force",     description: "14-day streak",                          category: "streak",  icon: "💥",  xpReward: 500  },
  { id: "streak_21",   title: "Habit Former",        description: "21-day streak — the habit window",       category: "streak",  icon: "💎",  xpReward: 700  },
  { id: "streak_30",   title: "Monthly Master",      description: "30-day streak",                          category: "streak",  icon: "🏆",  xpReward: 1000 },
  { id: "streak_45",   title: "Relentless",          description: "45-day streak",                          category: "streak",  icon: "🛡️",  xpReward: 1500 },
  { id: "streak_66",   title: "Hardwired",           description: "66 days — science says it's a habit!",  category: "streak",  icon: "🧠",  xpReward: 2000 },
  { id: "streak_90",   title: "Quarter Century",     description: "90-day streak",                          category: "streak",  icon: "🌟",  xpReward: 3000 },
  { id: "streak_100",  title: "Century Saver",       description: "100-day streak",                         category: "streak",  icon: "👑",  xpReward: 5000 },
  { id: "streak_180",  title: "Half Year Hero",      description: "180-day streak",                         category: "streak",  icon: "🌈",  xpReward: 8000 },
  { id: "streak_365",  title: "Year of the Saver",   description: "365-day streak — you are a legend",      category: "streak",  icon: "🏅",  xpReward: 20000},

  // ── SAVINGS MILESTONES (16) ───────────────────────────────
  { id: "first_save",     title: "First Step",        description: "Log your very first saving",            category: "savings", icon: "🌱",  xpReward: 50   },
  { id: "saved_50",       title: "Fifty Rand",        description: "Total saved: R50",                      category: "savings", icon: "🪙",  xpReward: 75   },
  { id: "saved_100",      title: "Triple Digits",     description: "Total saved: R100",                     category: "savings", icon: "💰",  xpReward: 100  },
  { id: "saved_250",      title: "Quarter Grand",     description: "Total saved: R250",                     category: "savings", icon: "💵",  xpReward: 150  },
  { id: "saved_500",      title: "Half Grand",        description: "Total saved: R500",                     category: "savings", icon: "💶",  xpReward: 200  },
  { id: "saved_1000",     title: "Four Figures",      description: "Total saved: R1,000",                   category: "savings", icon: "💴",  xpReward: 350  },
  { id: "saved_2500",     title: "Two-Five Club",     description: "Total saved: R2,500",                   category: "savings", icon: "📈",  xpReward: 500  },
  { id: "saved_5000",     title: "Five Thousand",     description: "Total saved: R5,000",                   category: "savings", icon: "🎯",  xpReward: 750  },
  { id: "saved_10000",    title: "Ten Thousander",    description: "Total saved: R10,000",                  category: "savings", icon: "🚀",  xpReward: 1500 },
  { id: "saved_25000",    title: "Quarter Lakh",      description: "Total saved: R25,000",                  category: "savings", icon: "💎",  xpReward: 3000 },
  { id: "first_goal",     title: "Goal Getter",       description: "Complete your first savings goal",      category: "savings", icon: "✅",  xpReward: 500  },
  { id: "three_goals",    title: "Triple Threat",     description: "Complete 3 goals",                      category: "savings", icon: "🎳",  xpReward: 1000 },
  { id: "five_goals",     title: "Goal Machine",      description: "Complete 5 goals",                      category: "savings", icon: "⚙️",  xpReward: 2000 },
  { id: "five_active",    title: "Hoarder",           description: "5 active goals at once",                category: "savings", icon: "📦",  xpReward: 200  },
  { id: "speed_30",       title: "Speed Runner",      description: "Complete a goal in under 30 days",      category: "savings", icon: "⚡",  xpReward: 500  },
  { id: "big_deposit",    title: "Big Spender",       description: "Single deposit over R1,000",            category: "savings", icon: "💸",  xpReward: 300  },

  // ── SAVINGS — progressive deposit-count tiers (Sprint 21, Phase 12) ──
  // Distinct from the amount-based "saved_*" tiers above: these track
  // *how many times* a user has deposited, not how much — a separate,
  // habit-oriented signal (someone making frequent small deposits earns
  // these even if their "saved_*" tier progress is slow).
  { id: "deposits_5",     title: "Getting Started",   description: "Make 5 deposits",                       category: "savings", icon: "🌿",  xpReward: 100  },
  { id: "deposits_25",    title: "Building Momentum", description: "Make 25 deposits",                      category: "savings", icon: "🌳",  xpReward: 300  },
  { id: "deposits_100",   title: "Habitual Saver",    description: "Make 100 deposits",                     category: "savings", icon: "🏔️",  xpReward: 800  },
  { id: "deposits_250",   title: "Deposit Master",    description: "Make 250 deposits",                     category: "savings", icon: "🗻",  xpReward: 2000 },
  { id: "deposits_500",   title: "Five Hundred Club", description: "Make 500 deposits",                     category: "savings", icon: "🏛️",  xpReward: 5000 },

  // ── QUEST & CHALLENGE (16) ────────────────────────────────
  { id: "first_quest",      title: "Quest Accepted",      description: "Complete your first quest",          category: "quest", icon: "⚔️",  xpReward: 200  },
  { id: "five_quests",      title: "Quest Adept",         description: "Complete 5 quests",                  category: "quest", icon: "🗡️",  xpReward: 500  },
  { id: "ten_quests",       title: "Quest Veteran",       description: "Complete 10 quests",                 category: "quest", icon: "🛡️",  xpReward: 1000 },
  { id: "twenty_quests",    title: "Quest Champion",      description: "Complete 20 quests",                 category: "quest", icon: "🏆",  xpReward: 2000 },
  { id: "no_takeout",       title: "No Takeout Survivor", description: "Complete No Takeout Week",           category: "quest", icon: "🥗",  xpReward: 300  },
  { id: "weekend_freeze",   title: "Weekend Warrior",     description: "Complete Weekend Spending Freeze",   category: "quest", icon: "❄️",  xpReward: 300  },
  { id: "daily_7",          title: "Daily Devotee",       description: "Complete 7 daily quests",            category: "quest", icon: "📅",  xpReward: 400  },
  { id: "daily_30",         title: "Monthly Devotee",     description: "Complete 30 daily quests total",     category: "quest", icon: "🗓️",  xpReward: 1500 },
  { id: "chain_starter",    title: "Chain Reaction",      description: "Complete your first quest chain",    category: "quest", icon: "🔗",  xpReward: 600  },
  { id: "chain_three",      title: "Chain Master",        description: "Complete 3 quest chains",            category: "quest", icon: "⛓️",  xpReward: 2000 },
  { id: "weekly_first",     title: "Weekly Warrior",      description: "Complete your first weekly quest",   category: "quest", icon: "🗓️",  xpReward: 250  },
  { id: "weekly_four",      title: "Monthly Warrior",     description: "Complete 4 weekly quests in a row",  category: "quest", icon: "🏹",  xpReward: 1000 },
  { id: "seasonal_first",   title: "Season Starter",      description: "Complete a seasonal challenge",      category: "quest", icon: "🌸",  xpReward: 500  },
  { id: "streak_shield_use",title: "Safety Net",          description: "Use your first streak shield",       category: "quest", icon: "🛡️",  xpReward: 50   },
  { id: "coffee_blackout",  title: "Caffeine Free",       description: "Complete Coffee Blackout challenge", category: "quest", icon: "☕",  xpReward: 200  },
  { id: "round_up",         title: "Round Up Ranger",     description: "Complete Round-Up Week",             category: "quest", icon: "🎯",  xpReward: 300  },

  // ── SPECIAL / SECRET (16) ────────────────────────────────
  { id: "night_owl",       title: "Night Owl",          description: "Log a saving after midnight",           category: "hidden",  icon: "🦉",  xpReward: 100,  secret: true },
  { id: "early_bird",      title: "Early Bird",         description: "Log a saving before 6am",              category: "hidden",  icon: "🐦",  xpReward: 100,  secret: true },
  { id: "comeback_king",   title: "Comeback King",      description: "Resume after a 30-day break",          category: "hidden",  icon: "🦅",  xpReward: 300,  secret: true },
  { id: "weekend_saver",   title: "Weekend Warrior",    description: "Log savings on 4 consecutive weekends",category: "hidden",  icon: "🏋️",  xpReward: 250,  secret: true },
  { id: "new_year",        title: "Fresh Start",        description: "Log a saving on Jan 1",                category: "hidden",  icon: "🎆",  xpReward: 200,  secret: true },
  { id: "birthday_save",   title: "Birthday Bonus",     description: "Save on your birthday",                category: "hidden",  icon: "🎂",  xpReward: 300,  secret: true },
  { id: "payday_save",     title: "Pay Yourself First", description: "Log savings 3x on the same day of month", category: "hidden", icon: "💰", xpReward: 300, secret: true },
  { id: "consistent_week", title: "Perfect Week",       description: "Complete all 7 daily quests in one week", category: "hidden", icon: "⭐", xpReward: 500,  secret: true },
  { id: "double_down",     title: "Double Down",        description: "Log 2 savings in one day",             category: "hidden",  icon: "✌️",  xpReward: 150,  secret: true },
  { id: "triple_down",     title: "Hat Trick",          description: "Log 3 savings in one day",             category: "hidden",  icon: "🎩",  xpReward: 300,  secret: true },
  { id: "round_number",    title: "Round Number",       description: "Save an exact round number (R100/R500/R1000)", category: "hidden", icon: "🎯", xpReward: 100, secret: true },
  { id: "first_100k",      title: "100K Club",          description: "Total saved: R100,000",               category: "hidden",  icon: "👑",  xpReward: 10000,secret: true },
  { id: "questless",       title: "Just Because",       description: "Log a saving with no active quests",  category: "hidden",  icon: "🎲",  xpReward: 50,   secret: true },
  { id: "patient",         title: "The Patient One",    description: "Create a goal with target date 1yr+ away", category: "hidden", icon: "⏳", xpReward: 200, secret: true },
  { id: "overachiever",    title: "Overachiever",       description: "Exceed a goal by 10%",                category: "hidden",  icon: "📊",  xpReward: 300,  secret: true },
  { id: "perfectionist",   title: "Perfectionist",      description: "Complete a goal on exactly the target date", category: "hidden", icon: "🎯", xpReward: 500, secret: true },

  // ── SOCIAL (3) — Sprint 22, Phase 10. First entries in a category that
  // existed in the type union but had no achievements in it until now.
  { id: "referral_first",  title: "Plus One",           description: "Invite your first friend to SaveQuest",  category: "social",  icon: "🤝",  xpReward: 200  },
  { id: "referral_five",   title: "Squad Builder",      description: "5 successful referrals",                 category: "social",  icon: "👥",  xpReward: 750  },
  { id: "referral_ten",    title: "Community Pillar",   description: "10 successful referrals",                category: "social",  icon: "🏘️",  xpReward: 2000 },
];

// ── CHECK FUNCTION ────────────────────────────────────────────
export function checkAchievements(params: {
  streakDays: number;
  totalSaved: number;
  goalsCompleted: number;
  activeGoals: number;
  challengesCompleted: number;
  dailyQuestsCompleted: number;
  weeklyQuestsCompleted: number;
  questChainsCompleted: number;
  transactionAmount?: number;
  transactionHour?: number;
  transactionCount?: number;         // total transactions today
  daysSinceLastActive?: number;
  goalCompletedInDays?: number;
  goalExceededByPercent?: number;    // how much over target
  goalTargetDaysAway?: number;       // days until target when created
  /**
   * Sprint 21, Phase 12 — total lifetime deposit count (not "today's
   * count", unlike `transactionCount` above). Optional and additive: this
   * function's existing callers pass nothing for it and every other check
   * below is unaffected, so this doesn't change behavior for callers that
   * don't opt in. Wiring the actual count into the deposit API route
   * (where `transactionCount`/`totalSaved` are already tallied) is a
   * follow-up — deliberately not touched this sprint to avoid changes near
   * the deposit-writing code path (see docs/SPRINT21_BEHAVIOR.md, Security
   * Audit).
   */
  lifetimeDepositCount?: number;
  earnedIds: string[];
}): Achievement[] {
  const { earnedIds } = params;
  const earned = new Set(earnedIds);
  const newAchievements: Achievement[] = [];

  function check(id: string, condition: boolean) {
    if (condition && !earned.has(id)) {
      const a = ACHIEVEMENTS.find(a => a.id === id);
      if (a) newAchievements.push(a);
    }
  }

  // Streak
  check("streak_1",   params.streakDays >= 1);
  check("streak_3",   params.streakDays >= 3);
  check("streak_7",   params.streakDays >= 7);
  check("streak_14",  params.streakDays >= 14);
  check("streak_21",  params.streakDays >= 21);
  check("streak_30",  params.streakDays >= 30);
  check("streak_45",  params.streakDays >= 45);
  check("streak_66",  params.streakDays >= 66);
  check("streak_90",  params.streakDays >= 90);
  check("streak_100", params.streakDays >= 100);
  check("streak_180", params.streakDays >= 180);
  check("streak_365", params.streakDays >= 365);

  // Savings
  check("first_save",  (params.transactionCount ?? 0) >= 1 || params.totalSaved > 0);
  check("saved_50",    params.totalSaved >= 50);
  check("saved_100",   params.totalSaved >= 100);
  check("saved_250",   params.totalSaved >= 250);
  check("saved_500",   params.totalSaved >= 500);
  check("saved_1000",  params.totalSaved >= 1000);
  check("saved_2500",  params.totalSaved >= 2500);
  check("saved_5000",  params.totalSaved >= 5000);
  check("saved_10000", params.totalSaved >= 10000);
  check("saved_25000", params.totalSaved >= 25000);
  check("first_goal",  params.goalsCompleted >= 1);
  check("three_goals", params.goalsCompleted >= 3);
  check("five_goals",  params.goalsCompleted >= 5);
  check("five_active", params.activeGoals >= 5);
  check("speed_30",    (params.goalCompletedInDays ?? 999) <= 30);
  check("big_deposit", (params.transactionAmount ?? 0) >= 1000);

  // Progressive deposit-count tiers (Sprint 21, Phase 12)
  check("deposits_5",   (params.lifetimeDepositCount ?? 0) >= 5);
  check("deposits_25",  (params.lifetimeDepositCount ?? 0) >= 25);
  check("deposits_100", (params.lifetimeDepositCount ?? 0) >= 100);
  check("deposits_250", (params.lifetimeDepositCount ?? 0) >= 250);
  check("deposits_500", (params.lifetimeDepositCount ?? 0) >= 500);

  // Quests
  check("first_quest",      params.challengesCompleted >= 1);
  check("five_quests",      params.challengesCompleted >= 5);
  check("ten_quests",       params.challengesCompleted >= 10);
  check("twenty_quests",    params.challengesCompleted >= 20);
  check("daily_7",          params.dailyQuestsCompleted >= 7);
  check("daily_30",         params.dailyQuestsCompleted >= 30);
  check("weekly_first",     params.weeklyQuestsCompleted >= 1);
  check("weekly_four",      params.weeklyQuestsCompleted >= 4);
  check("chain_starter",    params.questChainsCompleted >= 1);
  check("chain_three",      params.questChainsCompleted >= 3);

  // Hidden
  check("night_owl",       (params.transactionHour ?? -1) >= 0 && (params.transactionHour ?? -1) < 4);
  check("early_bird",      (params.transactionHour ?? 12) < 6);
  check("comeback_king",   (params.daysSinceLastActive ?? 0) >= 30);
  check("double_down",     (params.transactionCount ?? 0) >= 2);
  check("triple_down",     (params.transactionCount ?? 0) >= 3);
  check("overachiever",    (params.goalExceededByPercent ?? 0) >= 10);
  check("patient",         (params.goalTargetDaysAway ?? 0) >= 365);
  check("first_100k",      params.totalSaved >= 100000);

  return newAchievements;
}

// ── "ALMOST" MESSAGES ─────────────────────────────────────────
// Returns up to 2 messages about achievements the user is close to.
// Used on the dashboard to create the Zeigarnik pull.
export function getAlmostMessages(params: {
  streakDays: number;
  totalSaved: number;
  goalsCompleted: number;
  challengesCompleted: number;
  dailyQuestsCompleted: number;
  earnedIds: string[];
  /** Sprint 31 — Phase 5: optional, defaults preserve the exact previous
   * hardcoded "R" behavior for any existing caller that doesn't pass one. */
  currencyCode?: string;
  locale?: string;
}): { message: string; icon: string }[] {
  const earned = new Set(params.earnedIds);
  const hints: { message: string; icon: string; urgency: number }[] = [];

  // Streak proximity
  const streakTargets = [3, 7, 14, 21, 30, 45, 66, 90, 100];
  for (const t of streakTargets) {
    if (!earned.has(`streak_${t}`) && params.streakDays >= t * 0.75 && params.streakDays < t) {
      hints.push({ message: `${t - params.streakDays} more day${t - params.streakDays === 1 ? "" : "s"} to ${ACHIEVEMENTS.find(a => a.id === `streak_${t}`)?.title} ${ACHIEVEMENTS.find(a => a.id === `streak_${t}`)?.icon}`, icon: "🔥", urgency: 1 - (t - params.streakDays) / t });
      break;
    }
  }

  // Savings proximity
  const savingsTargets: [number, string][] = [[50,"saved_50"],[100,"saved_100"],[250,"saved_250"],[500,"saved_500"],[1000,"saved_1000"],[2500,"saved_2500"],[5000,"saved_5000"],[10000,"saved_10000"]];
  for (const [target, id] of savingsTargets) {
    if (!earned.has(id) && params.totalSaved >= target * 0.75 && params.totalSaved < target) {
      const remaining = target - params.totalSaved;
      const a = ACHIEVEMENTS.find(a => a.id === id);
      const formatted = formatAmount(remaining, params.currencyCode ?? DEFAULT_CURRENCY, params.locale ?? DEFAULT_LOCALE);
      hints.push({ message: `${formatted} away from ${a?.title} ${a?.icon}`, icon: "💰", urgency: 1 - remaining / target });
      break;
    }
  }

  // Daily quests proximity
  const questTargets: [number, string][] = [[7,"daily_7"],[30,"daily_30"]];
  for (const [target, id] of questTargets) {
    if (!earned.has(id) && params.dailyQuestsCompleted >= target * 0.75 && params.dailyQuestsCompleted < target) {
      const remaining = target - params.dailyQuestsCompleted;
      const a = ACHIEVEMENTS.find(a => a.id === id);
      hints.push({ message: `${remaining} more daily quest${remaining === 1 ? "" : "s"} to ${a?.title} ${a?.icon}`, icon: "📅", urgency: 1 - remaining / target });
      break;
    }
  }

  // Sort by urgency (closest to completion first), return top 2
  return hints
    .sort((a, b) => b.urgency - a.urgency)
    .slice(0, 2)
    .map(({ message, icon }) => ({ message, icon }));
}