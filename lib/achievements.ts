export interface Achievement {
  id: string;
  title: string;
  description: string;
  category: "streak" | "milestone" | "challenge" | "special";
  icon: string;
  xpReward: number;
  secret?: boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  // Streak
  { id: "streak_3",   title: "On a Roll",        description: "3-day streak",   category: "streak",    icon: "🔥",  xpReward: 100 },
  { id: "streak_7",   title: "Week Warrior",      description: "7-day streak",   category: "streak",    icon: "⚡",  xpReward: 300 },
  { id: "streak_21",  title: "Habit Former",      description: "21-day streak",  category: "streak",    icon: "💎",  xpReward: 700 },
  { id: "streak_30",  title: "Monthly Master",    description: "30-day streak",  category: "streak",    icon: "🏆",  xpReward: 1000 },
  { id: "streak_66",  title: "Hardwired",         description: "66-day streak — science says it's a habit!", category: "streak", icon: "🧠", xpReward: 2000 },
  { id: "streak_100", title: "Century Saver",     description: "100-day streak", category: "streak",    icon: "👑",  xpReward: 5000 },

  // Milestone
  { id: "first_save",    title: "First Step",       description: "Logged your very first saving",  category: "milestone", icon: "🌱", xpReward: 50 },
  { id: "saved_100",     title: "Triple Digits",    description: "Saved R100 total",               category: "milestone", icon: "💰", xpReward: 100 },
  { id: "saved_1000",    title: "Four Figures",     description: "Saved R1,000 total",             category: "milestone", icon: "💵", xpReward: 300 },
  { id: "saved_5000",    title: "Five Thousand",    description: "Saved R5,000 total",             category: "milestone", icon: "🎯", xpReward: 750 },
  { id: "saved_10000",   title: "Ten Thousander",   description: "Saved R10,000 total",            category: "milestone", icon: "🚀", xpReward: 1500 },
  { id: "first_goal",    title: "Goal Getter",      description: "Completed your first goal",      category: "milestone", icon: "✅", xpReward: 500 },
  { id: "three_goals",   title: "Triple Threat",    description: "Completed 3 goals",              category: "milestone", icon: "🎳", xpReward: 1000 },
  { id: "five_active",   title: "Hoarder",          description: "5 active goals at once",         category: "milestone", icon: "📦", xpReward: 200 },

  // Challenge
  { id: "first_challenge", title: "Quest Accepted", description: "Completed your first challenge", category: "challenge", icon: "⚔️", xpReward: 200 },
  { id: "no_takeout",      title: "No Takeout Survivor", description: "Completed No Takeout Week", category: "challenge", icon: "🥗", xpReward: 300 },
  { id: "weekend_freeze",  title: "Weekend Warrior", description: "Completed Weekend Spending Freeze", category: "challenge", icon: "❄️", xpReward: 300 },
  { id: "five_challenges", title: "Quest Champion",  description: "Completed 5 challenges",        category: "challenge", icon: "🛡️", xpReward: 500 },

  // Special / Secret
  { id: "night_owl",      title: "Night Owl",        description: "Logged a saving after midnight", category: "special", icon: "🦉", xpReward: 100, secret: true },
  { id: "speed_runner",   title: "Speed Runner",     description: "Completed a goal in under 30 days", category: "special", icon: "⚡", xpReward: 500, secret: true },
  { id: "comeback_king",  title: "Comeback King",    description: "Resumed saving after a 30-day break", category: "special", icon: "🦅", xpReward: 300, secret: true },
  { id: "big_deposit",    title: "Big Spender",      description: "Logged a single saving over R1,000", category: "special", icon: "💸", xpReward: 200, secret: true },
];

export function checkAchievements(params: {
  streakDays: number;
  totalSaved: number;
  goalsCompleted: number;
  activeGoals: number;
  challengesCompleted: number;
  transactionAmount?: number;
  transactionHour?: number;
  daysSinceLastActive?: number;
  goalCompletedInDays?: number;
  earnedIds: string[];
}): Achievement[] {
  const { earnedIds } = params;
  const earned = new Set(earnedIds);
  const newAchievements: Achievement[] = [];

  function check(id: string, condition: boolean) {
    if (condition && !earned.has(id)) {
      const a = ACHIEVEMENTS.find((a) => a.id === id);
      if (a) newAchievements.push(a);
    }
  }

  check("streak_3",   params.streakDays >= 3);
  check("streak_7",   params.streakDays >= 7);
  check("streak_21",  params.streakDays >= 21);
  check("streak_30",  params.streakDays >= 30);
  check("streak_66",  params.streakDays >= 66);
  check("streak_100", params.streakDays >= 100);

  check("saved_100",   params.totalSaved >= 100);
  check("saved_1000",  params.totalSaved >= 1000);
  check("saved_5000",  params.totalSaved >= 5000);
  check("saved_10000", params.totalSaved >= 10000);
  check("first_goal",  params.goalsCompleted >= 1);
  check("three_goals", params.goalsCompleted >= 3);
  check("five_active", params.activeGoals >= 5);

  check("first_challenge", params.challengesCompleted >= 1);
  check("five_challenges", params.challengesCompleted >= 5);

  check("night_owl",    (params.transactionHour ?? -1) >= 0 && (params.transactionHour ?? -1) < 4);
  check("big_deposit",  (params.transactionAmount ?? 0) >= 1000);
  check("speed_runner", (params.goalCompletedInDays ?? 999) <= 30);
  check("comeback_king",(params.daysSinceLastActive ?? 0) >= 30);

  return newAchievements;
}
