// ============================================================
// SaveQuest Quest System
// Daily quests, Weekly quests, Quest Chains, Seasonal quests
// ============================================================

export type QuestType = "daily" | "weekly" | "seasonal" | "chain";
export type QuestCategory = "savings" | "behavioral" | "streak" | "challenge";

export interface QuestTemplate {
  id: string;
  title: string;
  description: string;
  type: QuestType;
  category: QuestCategory;
  xpReward: number;
  icon: string;
  // for daily rotation — day of week (0=Sun) or null for any
  dayOfWeek?: number;
}

export interface QuestChain {
  id: string;
  title: string;
  description: string;
  icon: string;
  steps: QuestChainStep[];
  completionXP: number;
  completionBadgeId?: string;
}

export interface QuestChainStep {
  stepNumber: number;
  title: string;
  description: string;
  xpReward: number;
  requiresType: "save_amount" | "streak" | "complete_quest" | "complete_daily" | "open_app";
  requiresValue: number;   // amount / days / count
  requiresQuestId?: string;
}

// ── DAILY QUEST POOL ─────────────────────────────────────────
// 7 quests rotate daily (1 per day). They reset at midnight.
export const DAILY_QUESTS: QuestTemplate[] = [
  {
    id: "daily_checkin",
    title: "Daily Check-In",
    description: "Open SaveQuest and review your goals today.",
    type: "daily", category: "behavioral",
    xpReward: 75, icon: "📱",
  },
  {
    id: "daily_save_any",
    title: "Save Something",
    description: "Log any saving today, no matter how small.",
    type: "daily", category: "savings",
    xpReward: 100, icon: "💰",
  },
  {
    id: "daily_skip_purchase",
    title: "Skip One Impulse",
    description: "Identify one impulse purchase you skipped today.",
    type: "daily", category: "behavioral",
    xpReward: 75, icon: "🙅",
  },
  {
    id: "daily_lunch_home",
    title: "Eat from Home",
    description: "Bring or make your own lunch instead of buying.",
    type: "daily", category: "behavioral",
    xpReward: 75, icon: "🥙",
  },
  {
    id: "daily_review_goal",
    title: "Goal Visualisation",
    description: "Open a savings goal and visualise achieving it.",
    type: "daily", category: "behavioral",
    xpReward: 50, icon: "👁️",
  },
  {
    id: "daily_save_20",
    title: "Save R20",
    description: "Log at least R20 in savings today.",
    type: "daily", category: "savings",
    xpReward: 100, icon: "🪙",
  },
  {
    id: "daily_no_delivery",
    title: "No Delivery Today",
    description: "No food delivery apps today. Cook or prep instead.",
    type: "daily", category: "behavioral",
    xpReward: 75, icon: "🚫",
  },
];

// ── WEEKLY QUESTS ─────────────────────────────────────────────
export const WEEKLY_QUESTS: QuestTemplate[] = [
  {
    id: "weekly_no_takeout",
    title: "No Takeout Week",
    description: "Zero takeout or food delivery for 7 days.",
    type: "weekly", category: "behavioral",
    xpReward: 400, icon: "🥗",
  },
  {
    id: "weekly_save_50_daily",
    title: "Save R50 Daily",
    description: "Log at least R50 every day this week.",
    type: "weekly", category: "savings",
    xpReward: 500, icon: "📅",
  },
  {
    id: "weekly_no_shopping",
    title: "No Shopping Week",
    description: "No non-essential purchases for 7 days.",
    type: "weekly", category: "behavioral",
    xpReward: 450, icon: "🛒",
  },
  {
    id: "weekly_save_500",
    title: "Save R500",
    description: "Log a total of R500 in savings this week.",
    type: "weekly", category: "savings",
    xpReward: 500, icon: "💵",
  },
  {
    id: "weekly_7_checkins",
    title: "Perfect Attendance",
    description: "Complete a daily quest every single day this week.",
    type: "weekly", category: "streak",
    xpReward: 600, icon: "✅",
  },
  {
    id: "weekly_coffee_ban",
    title: "Coffee Blackout",
    description: "No bought coffee for 5 days. Brew at home.",
    type: "weekly", category: "behavioral",
    xpReward: 300, icon: "☕",
  },
  {
    id: "weekly_round_up",
    title: "Round-Up Week",
    description: "Every time you spend, log the round-up as savings.",
    type: "weekly", category: "savings",
    xpReward: 350, icon: "🎯",
  },
  {
    id: "weekly_weekend_freeze",
    title: "Weekend Spending Freeze",
    description: "Zero non-essential spending Saturday and Sunday.",
    type: "weekly", category: "behavioral",
    xpReward: 350, icon: "❄️",
  },
];

// ── SEASONAL QUESTS ───────────────────────────────────────────
export const SEASONAL_QUESTS: QuestTemplate[] = [
  {
    id: "seasonal_new_year",
    title: "New Year, New Fund",
    description: "Start a brand-new savings goal in January.",
    type: "seasonal", category: "savings",
    xpReward: 500, icon: "🎆",
  },
  {
    id: "seasonal_black_friday",
    title: "Black Friday Blackout",
    description: "Make zero impulse purchases on Black Friday.",
    type: "seasonal", category: "behavioral",
    xpReward: 600, icon: "🖤",
  },
  {
    id: "seasonal_month_end",
    title: "Month-End Sprint",
    description: "Save at least R500 before month end.",
    type: "seasonal", category: "savings",
    xpReward: 500, icon: "🏃",
  },
  {
    id: "seasonal_tax_season",
    title: "Tax Season Stash",
    description: "Build your emergency fund in March/April.",
    type: "seasonal", category: "savings",
    xpReward: 600, icon: "📋",
  },
  {
    id: "seasonal_winter_saver",
    title: "Winter Warmer Fund",
    description: "Save for a specific winter expense in June/July.",
    type: "seasonal", category: "savings",
    xpReward: 400, icon: "🧥",
  },
  {
    id: "seasonal_year_recap",
    title: "Year in Review",
    description: "Log your total savings for the year in December.",
    type: "seasonal", category: "savings",
    xpReward: 800, icon: "🎁",
  },
];

// ── QUEST CHAINS ──────────────────────────────────────────────
export const QUEST_CHAINS: QuestChain[] = [
  {
    id: "chain_starter_saver",
    title: "Starter Saver",
    description: "Your first steps as a saver. Build the foundation.",
    icon: "🌱",
    completionXP: 500,
    completionBadgeId: "chain_starter",
    steps: [
      { stepNumber: 1, title: "Open the App",           description: "Log into SaveQuest for the first time.", xpReward: 50,  requiresType: "open_app",       requiresValue: 1 },
      { stepNumber: 2, title: "Create a Goal",           description: "Set up your very first savings goal.",   xpReward: 75,  requiresType: "complete_daily", requiresValue: 1 },
      { stepNumber: 3, title: "First Deposit",           description: "Log your first saving of any amount.",   xpReward: 100, requiresType: "save_amount",    requiresValue: 1 },
      { stepNumber: 4, title: "3-Day Streak",            description: "Stay active 3 days in a row.",           xpReward: 150, requiresType: "streak",         requiresValue: 3 },
      { stepNumber: 5, title: "First Quest",             description: "Complete any daily quest.",               xpReward: 150, requiresType: "complete_daily", requiresValue: 1 },
    ],
  },
  {
    id: "chain_no_spend_hero",
    title: "No-Spend Hero",
    description: "Master the art of not spending.",
    icon: "🙅",
    completionXP: 750,
    completionBadgeId: "no_takeout",
    steps: [
      { stepNumber: 1, title: "Skip an Impulse",         description: "Complete the Skip One Impulse daily quest.",      xpReward: 100, requiresType: "complete_quest", requiresValue: 1, requiresQuestId: "daily_skip_purchase" },
      { stepNumber: 2, title: "No-Delivery Day",         description: "Complete No Delivery Today daily quest.",          xpReward: 100, requiresType: "complete_quest", requiresValue: 1, requiresQuestId: "daily_no_delivery"   },
      { stepNumber: 3, title: "Weekend Freeze",          description: "Complete Weekend Spending Freeze.",                xpReward: 200, requiresType: "complete_quest", requiresValue: 1, requiresQuestId: "weekly_weekend_freeze"},
      { stepNumber: 4, title: "No Takeout Week",         description: "Complete No Takeout Week.",                        xpReward: 300, requiresType: "complete_quest", requiresValue: 1, requiresQuestId: "weekly_no_takeout"   },
    ],
  },
  {
    id: "chain_savings_sprint",
    title: "Savings Sprint",
    description: "Build momentum by saving consistently for 2 weeks.",
    icon: "🏃",
    completionXP: 1000,
    steps: [
      { stepNumber: 1, title: "Save R50",                description: "Log R50 in total savings.",               xpReward: 75,  requiresType: "save_amount",    requiresValue: 50   },
      { stepNumber: 2, title: "Save R200",               description: "Log R200 in total savings.",              xpReward: 100, requiresType: "save_amount",    requiresValue: 200  },
      { stepNumber: 3, title: "Save R500",               description: "Log R500 in total savings.",              xpReward: 150, requiresType: "save_amount",    requiresValue: 500  },
      { stepNumber: 4, title: "7-Day Streak",            description: "Keep your streak alive for 7 days.",      xpReward: 200, requiresType: "streak",         requiresValue: 7    },
      { stepNumber: 5, title: "Save R1,000",             description: "Log R1,000 in total savings.",            xpReward: 300, requiresType: "save_amount",    requiresValue: 1000 },
    ],
  },
  {
    id: "chain_emergency_fund",
    title: "Emergency Fund Initiate",
    description: "Build your financial safety net step by step.",
    icon: "🛡️",
    completionXP: 1500,
    steps: [
      { stepNumber: 1, title: "Create Emergency Goal",   description: "Set up an Emergency Fund goal.",          xpReward: 100, requiresType: "complete_daily", requiresValue: 1   },
      { stepNumber: 2, title: "First R500",              description: "Save R500 toward your emergency fund.",   xpReward: 200, requiresType: "save_amount",    requiresValue: 500 },
      { stepNumber: 3, title: "Stay Consistent",         description: "Maintain a 14-day streak.",               xpReward: 300, requiresType: "streak",         requiresValue: 14  },
      { stepNumber: 4, title: "Reach R1,000",            description: "Save R1,000 total.",                      xpReward: 400, requiresType: "save_amount",    requiresValue: 1000},
      { stepNumber: 5, title: "Complete the Fund",       description: "Fully complete your emergency goal.",     xpReward: 500, requiresType: "complete_quest", requiresValue: 1   },
    ],
  },
  {
    id: "chain_habit_master",
    title: "Habit Master",
    description: "Science says 66 days makes a habit. Prove it.",
    icon: "🧠",
    completionXP: 3000,
    completionBadgeId: "streak_66",
    steps: [
      { stepNumber: 1, title: "7-Day Streak",            description: "Active for 7 consecutive days.",          xpReward: 300,  requiresType: "streak", requiresValue: 7  },
      { stepNumber: 2, title: "21-Day Streak",           description: "Active for 21 consecutive days.",         xpReward: 700,  requiresType: "streak", requiresValue: 21 },
      { stepNumber: 3, title: "30-Day Streak",           description: "Active for 30 consecutive days.",         xpReward: 1000, requiresType: "streak", requiresValue: 30 },
      { stepNumber: 4, title: "66-Day Streak",           description: "66 days — the habit is hardwired.",       xpReward: 2000, requiresType: "streak", requiresValue: 66 },
    ],
  },
  {
    id: "chain_goal_crusher",
    title: "Goal Crusher",
    description: "Set goals. Crush them. Repeat.",
    icon: "🎯",
    completionXP: 2000,
    steps: [
      { stepNumber: 1, title: "First Goal Complete",     description: "Complete any savings goal.",              xpReward: 500,  requiresType: "complete_quest", requiresValue: 1 },
      { stepNumber: 2, title: "Second Goal Complete",    description: "Complete a second savings goal.",         xpReward: 600,  requiresType: "complete_quest", requiresValue: 2 },
      { stepNumber: 3, title: "Third Goal Complete",     description: "Three goals down. You're on fire.",       xpReward: 700,  requiresType: "complete_quest", requiresValue: 3 },
    ],
  },
];

// Helper: get today's daily quest (rotates by day of year)
export function getTodaysDailyQuest(): QuestTemplate {
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000
  );
  return DAILY_QUESTS[dayOfYear % DAILY_QUESTS.length];
}

// Helper: get this week's weekly quest (rotates by week number)
export function getThisWeeksQuest(): QuestTemplate {
  const weekNum = Math.floor(Date.now() / (7 * 86400000));
  return WEEKLY_QUESTS[weekNum % WEEKLY_QUESTS.length];
}
