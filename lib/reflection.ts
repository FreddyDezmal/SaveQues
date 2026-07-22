/// lib/reflection.ts

// ── Weekly Reflection System ───────────────────────────────────
// Closes the loop between daily actions and long-term outcomes.
// Fires every Sunday evening. One of the highest-retention features.

export interface ReflectionData {
  displayName: string;
  primaryGoalTitle: string;
  primaryGoalPercent: number;
  primaryGoalMilestoneHit?: 25 | 50 | 75 | 100;
  savingsCount: number;
  questsCompleted: number;
  streakDays: number;
  streakGrew: boolean;
  xpEarned: number;
  weeklyTargetAmount?: number;
  currencyCode: string;
  locale: string;
}

export interface ReflectionOutput {
  lines: string[];
  forwardLine: string;
  insight?: string;
}

/**
 * Generate a weekly reflection message from activity data.
 * All copy is positive and forward-facing — never shame, never guilt.
 */
export function generateReflection(data: ReflectionData): ReflectionOutput {
  const lines: string[] = [];

  // What happened this week
  if (data.savingsCount > 0) {
    lines.push(
      data.savingsCount === 1
        ? "✓ You logged a saving this week"
        : `✓ You saved ${data.savingsCount} times`
    );
  }

  if (data.questsCompleted > 0) {
    lines.push(
      data.questsCompleted === 1
        ? "✓ You completed 1 quest"
        : `✓ You completed ${data.questsCompleted} quests`
    );
  }

  if (data.streakGrew) {
    lines.push(`✓ Your streak grew to ${data.streakDays} days`);
  } else if (data.streakDays > 0) {
    lines.push(`✓ You maintained your ${data.streakDays}-day streak`);
  }

  // Goal progress line
  const goalLine = data.primaryGoalMilestoneHit
    ? milestoneMessage(data.primaryGoalMilestoneHit, data.primaryGoalTitle)
    : `Your ${data.primaryGoalTitle} is now ${Math.round(data.primaryGoalPercent)}% complete.`;

  // Forward-looking line
  const forwardLine = buildForwardLine(data);

  // Optional behavioural insight
  const insight = data.savingsCount >= 3
    ? `Every time you saved this week, that was a step toward ${data.primaryGoalTitle}.`
    : undefined;

  return { lines, forwardLine: `${goalLine} ${forwardLine}`, insight };
}

function milestoneMessage(milestone: 25 | 50 | 75 | 100, goalTitle: string): string {
  const messages = {
    25:  `You just crossed 25% on ${goalTitle}. One quarter done. 🎯`,
    50:  `You're halfway to ${goalTitle}. That's real. 🔥`,
    75:  `${goalTitle} is at 75% — one more good week. ⚡`,
    100: `You completed ${goalTitle}. That's everything. 🏆`,
  };
  return messages[milestone];
}

function buildForwardLine(data: ReflectionData): string {
  const remaining = 100 - data.primaryGoalPercent;

  if (remaining <= 10) {
    return `You're almost there — one more push finishes it.`;
  }
  if (data.weeklyTargetAmount) {
    return `Next week, stay consistent and you'll keep moving forward.`;
  }
  if (data.questsCompleted === 0 && data.savingsCount === 0) {
    return `Next week is a fresh start. One small action is all it takes.`;
  }
  return `Keep the momentum going into next week.`;
}

/**
 * Determine if a weekly reflection should be shown.
 * Shows once per week — Sunday evening or Monday morning.
 * Returns true if last viewed reflection was more than 6 days ago.
 */
export function shouldShowReflection(lastViewedAt: string | null): boolean {
  if (!lastViewedAt) return false;
  const daysSince = Math.floor(
    (Date.now() - new Date(lastViewedAt).getTime()) / 86400000
  );
  return daysSince >= 6;
}

/**
 * Get the start of the current week (Monday, UTC).
 *
 * Bug fix (code review): re-exported from lib/weeklyQuests.ts instead of
 * keeping a second local-time implementation here — see the comment on
 * getWeekStart() in that file for why the duplication was a problem.
 */
export { getWeekStart } from "./weeklyQuests";