/**
 * lib/awardXP.ts
 * ─────────────────────────────────────────────────────────────
 * THE single authoritative path for awarding XP in SaveQuest.
 *
 * Rules:
 *  • Only call this from server-side code (API routes / Server Components).
 *  • Never call this from client components.
 *  • Every XP grant must have a source_type and a source_id that together
 *    form a unique key for that specific real-world event.
 *
 * Idempotency guarantee:
 *  • The underlying award_xp() Postgres function inserts into xp_awards
 *    with a UNIQUE (user_id, source_type, source_id) constraint.
 *  • A duplicate call returns { xpAwarded: 0, reason: "already_awarded" }
 *    without throwing — callers can treat this as a success.
 */

import { createClient } from "@/lib/supabase/server";
import { checkAchievements, ACHIEVEMENTS } from "@/lib/achievements";
import { sendAchievementUnlocked, sendMilestoneCelebration } from "@/lib/notifications";
import { getLevelFromXP } from "@/lib/xp";

// ── Types ─────────────────────────────────────────────────────

export type XPSourceType =
  | "daily_quest"
  | "weekly_quest"
  | "challenge"
  | "chain_step"
  | "chain_complete"
  | "log_saving"
  | "goal_complete"
  | "event_complete"
  | "achievement"
  | "admin_grant";

export interface AwardXPResult {
  success: boolean;
  xpAwarded: number;
  newTotal: number;
  alreadyAwarded: boolean;
  error?: string;
}

export interface AwardXPWithAchievementsResult extends AwardXPResult {
  newAchievements: {
    id: string;
    title: string;
    icon: string;
    xpReward: number;
  }[];
}

// ── Core awardXP ─────────────────────────────────────────────

/**
 * Awards XP for a single action.
 * Idempotent: calling twice with the same (userId, sourceType, sourceId)
 * is safe — the second call returns alreadyAwarded: true, xpAwarded: 0.
 */
export async function awardXP(
  userId: string,
  sourceType: XPSourceType,
  sourceId: string,
  xp: number
): Promise<AwardXPResult> {
  const supabase = createClient();

  const { data, error } = await supabase.rpc("award_xp", {
    p_user_id:     userId,
    p_source_type: sourceType,
    p_source_id:   sourceId,
    p_xp:          xp,
  });

  if (error) {
    console.error("[awardXP] RPC error:", error);
    return { success: false, xpAwarded: 0, newTotal: 0, alreadyAwarded: false, error: error.message };
  }

  const result = data as { success: boolean; xp_awarded: number; new_total: number; reason?: string; error?: string };

  return {
    success:        result.success,
    xpAwarded:      result.xp_awarded ?? 0,
    newTotal:       result.new_total  ?? 0,
    alreadyAwarded: result.reason === "already_awarded",
    error:          result.error,
  };
}

// ── Achievement checker ───────────────────────────────────────

/**
 * Checks for newly unlocked achievements and awards their XP atomically.
 * Returns the list of newly unlocked achievements (for UI celebration).
 */
export async function checkAndAwardAchievements(
  userId: string,
  params: Parameters<typeof checkAchievements>[0]
): Promise<{ id: string; title: string; icon: string; xpReward: number }[]> {
  const supabase = createClient();

  const newAchievements = checkAchievements(params);
  if (newAchievements.length === 0) return [];

  const awarded: typeof newAchievements = [];

  for (const achievement of newAchievements) {
    const { data, error } = await supabase.rpc("award_achievement", {
      p_user_id:        userId,
      p_achievement_id: achievement.id,
      p_xp:             achievement.xpReward,
    });

    if (error) {
      console.error("[checkAndAwardAchievements] RPC error for", achievement.id, error);
      continue;
    }

    const result = data as { success: boolean; xp_awarded: number; reason?: string };
    // Only surface to the UI if it was actually newly granted this call
    if (result.success && (result.xp_awarded ?? 0) > 0) {
      awarded.push(achievement);

      // Sprint 17: fire-and-forget by design — deliberately NOT awaited.
      // This runs inside the request/response cycle of a deposit or goal
      // completion; a slow webpush send (network I/O to a push service)
      // or a transient error here must never add latency to, or fail, the
      // financial mutation that triggered it. The .catch() is what makes
      // "not awaited" safe — without it, an unhandled promise rejection
      // here would surface as an unhandled rejection warning/crash risk
      // at the process level even though nothing is awaiting it.
      sendAchievementUnlocked(userId, achievement.title, achievement.icon).catch((err) => {
        console.error("[checkAndAwardAchievements] Failed to send achievement notification:", err);
      });
    }
  }

  return awarded;
}

// ── Composite helpers used by API routes ─────────────────────

/**
 * Awards XP for a LOG_SAVING action and checks achievements.
 * sourceId = transaction UUID (ensures one XP award per transaction).
 */
export async function awardSavingXP(params: {
  userId: string;
  transactionId: string;
  xp: number;
  achievementParams: Parameters<typeof checkAchievements>[0];
}): Promise<AwardXPWithAchievementsResult> {
  const primary = await awardXP(params.userId, "log_saving", params.transactionId, params.xp);
  if (!primary.success) return { ...primary, newAchievements: [] };

  const newAchievements = primary.alreadyAwarded
    ? []
    : await checkAndAwardAchievements(params.userId, params.achievementParams);

  return { ...primary, newAchievements };
}

/**
 * Awards XP for a GOAL_COMPLETE action and checks achievements.
 * sourceId = goal UUID (ensures one award per goal completion).
 */
export async function awardGoalCompleteXP(params: {
  userId: string;
  goalId: string;
  xp: number;
  achievementParams: Parameters<typeof checkAchievements>[0];
  /**
   * Sprint 17: optional, backward-compatible addition — used to send the
   * milestone_celebration push notification with the actual goal name.
   * Callers that don't pass it (none currently, but any future/external
   * caller) simply don't get that notification rather than erroring.
   */
  goalTitle?: string;
}): Promise<AwardXPWithAchievementsResult> {
  const primary = await awardXP(params.userId, "goal_complete", params.goalId, params.xp);
  if (!primary.success) return { ...primary, newAchievements: [] };

  const newAchievements = primary.alreadyAwarded
    ? []
    : await checkAndAwardAchievements(params.userId, params.achievementParams);

  // Sprint 17: fire-and-forget, same reasoning as the achievement send in
  // checkAndAwardAchievements above — never let a push notification's
  // latency or failure affect this financial response. Only fires on the
  // FIRST completion of this goal (primary.alreadyAwarded false), so
  // re-triggering this endpoint idempotently never double-celebrates.
  if (!primary.alreadyAwarded && params.goalTitle) {
    sendMilestoneCelebration(params.userId, params.goalTitle).catch((err) => {
      console.error("[awardGoalCompleteXP] Failed to send milestone notification:", err);
    });
  }

  return { ...primary, newAchievements };
}

// ── Level-up detection ───────────────────────────────────────────────────────

/**
 * Determines whether an XP award crossed a level threshold.
 *
 * Pure function — no DB access, no side effects. Callers pass the XP total
 * BEFORE this award and the newTotal returned by awardXP()/awardSavingXP()/
 * awardGoalCompleteXP(). This is intentionally separate from the award
 * functions themselves: every existing call site already has both values
 * in scope (the profile fetch happens before the award, and newTotal comes
 * back from the award), so no extra DB round-trip is needed to detect a
 * level-up — it's purely arithmetic on values already in hand.
 *
 * Returns null if no level was crossed (most awards, especially small
 * ones, won't cross a threshold) — callers should only fire LEVEL_UP
 * analytics when this returns non-null.
 */
export function detectLevelUp(
  xpBefore: number,
  xpAfter: number
): { newLevel: number; newTitle: string; previousLevel: number } | null {
  if (xpAfter <= xpBefore) return null;

  const before = getLevelFromXP(xpBefore);
  const after  = getLevelFromXP(xpAfter);

  if (after.level <= before.level) return null;

  return { newLevel: after.level, newTitle: after.title, previousLevel: before.level };
}