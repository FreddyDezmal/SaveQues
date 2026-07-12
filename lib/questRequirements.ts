/**
 * lib/questRequirements.ts
 * ─────────────────────────────────────────────────────────────
 * Admin CRUD audit finding (see docs/ADMIN_CRUD_AUDIT.md): daily quests,
 * weekly quests, and quest chain steps could previously be marked
 * "complete" by any authenticated client with no server-side check that
 * the underlying requirement was actually met. This module is the single
 * shared place that answers "did this user actually satisfy this
 * requirement?" — used by:
 *   - app/api/quest/daily/complete/route.ts
 *   - app/api/quest/weekly/complete/route.ts
 *   - app/api/quest/chain/step/route.ts
 *
 * Pure, deterministic, no I/O — callers fetch the real data (profile,
 * transactions, quest logs) and pass it in as `RequirementContext`.
 */

/** Vocabulary for daily_quests / weekly_quests.requirement_type (migration 038). */
export type QuestRequirementType = "none" | "streak" | "save_amount";

/** Vocabulary for quest_chain_steps.requires_type — unchanged, pre-existing schema (migration 016). */
export type ChainStepRequirementType = "open_app" | "complete_daily" | "save_amount" | "streak" | "complete_quest";

export interface RequirementContext {
  streakDays: number;
  /** Lifetime total across all deposits — sum of positive transaction amounts, matching app/api/transactions/route.ts's `totalSaved` convention. */
  totalSaved: number;
  /** Sum of positive transaction amounts since the current week's start (Monday UTC). Only needed for weekly quest save_amount checks. */
  savedThisWeek?: number;
  /** Sum of positive transaction amounts today (UTC). Only needed for daily quest save_amount checks. */
  savedToday?: number;
  /** Cumulative daily-quest completions (profiles.daily_quests_completed). */
  dailyQuestsCompleted?: number;
  /**
   * IDs of daily *and* weekly quests the user has ever completed, merged
   * into one set — chain steps reference both kinds via requiresQuestId
   * (e.g. "daily_skip_purchase" and "weekly_no_takeout" both appear in
   * lib/quests.ts QUEST_CHAINS), and the id prefixes don't collide.
   */
  completedQuestIds?: Set<string>;
  /** Count of savings_goals rows with is_complete = true. Used for the "complete_quest" steps that mean "complete N goals" rather than a specific quest id — see checkChainStepRequirement's complete_quest case for the disambiguation rule. */
  completedGoalsCount?: number;
}

export interface RequirementCheckResult {
  met: boolean;
  reason: string;
  /**
   * True when the check couldn't be meaningfully evaluated against real
   * data (content gap, not a code gap) — the caller should NOT block on
   * this, but should log it so the gap is visible rather than silent.
   * See docs/ADMIN_CRUD_AUDIT.md for the specific QUEST_CHAINS entries
   * this currently applies to.
   */
  unverifiable?: boolean;
}

/**
 * Validates a daily_quests / weekly_quests row's requirement_type +
 * requirement_value against real data. `amountSaved` should be
 * `savedToday` for daily quests and `savedThisWeek` for weekly quests —
 * the caller picks which window applies.
 */
export function checkQuestRequirement(
  type: QuestRequirementType,
  value: number,
  ctx: RequirementContext,
  amountSaved: number | undefined
): RequirementCheckResult {
  switch (type) {
    case "none":
      // No structured requirement was configured for this quest — this is
      // the backward-compatible default (migration 038) and is treated as
      // self-reported, same as every quest behaved before this fix.
      return { met: true, reason: "No structured requirement configured — self-reported." };

    case "streak":
      return ctx.streakDays >= value
        ? { met: true, reason: `Streak is ${ctx.streakDays} days (needs ${value}).` }
        : { met: false, reason: `Streak is ${ctx.streakDays} days — needs ${value}.` };

    case "save_amount": {
      const saved = amountSaved ?? 0;
      return saved >= value
        ? { met: true, reason: `Saved ${saved} in the relevant window (needs ${value}).` }
        : { met: false, reason: `Only ${saved} saved in the relevant window — needs ${value}.` };
    }

    default:
      return { met: false, reason: `Unknown requirement type "${type}".` };
  }
}

/**
 * Validates a quest_chain_steps requirement (lib/quests.ts QUEST_CHAINS
 * constant — see docs/ADMIN_CRUD_AUDIT.md for why chains still run off
 * that hardcoded catalog rather than the DB table) against real data.
 *
 * AUDIT NOTE on "complete_quest": the existing QUEST_CHAINS content uses
 * this one requiresType for two different meanings, disambiguated only by
 * whether requiresQuestId is present:
 *   - WITH requiresQuestId ("Skip an Impulse" etc.): means "the specific
 *     daily/weekly quest with this id has been completed at least once."
 *   - WITHOUT requiresQuestId ("First Goal Complete", "Complete the
 *     Fund"): means "the user has completed at least `value` savings
 *     goals" — there's no schema linkage from a chain step to a specific
 *     goal instance, so "Complete the Fund" (emergency chain, step 5) is
 *     satisfied by *any* completed goal, not specifically the emergency
 *     fund goal from step 1 of the same chain. That's a real simplification,
 *     not a guess dressed up as one — it's documented here and in the audit
 *     doc so a future sprint can add goal-instance linkage if it matters.
 */
export function checkChainStepRequirement(
  type: ChainStepRequirementType,
  value: number,
  requiresQuestId: string | null | undefined,
  ctx: RequirementContext
): RequirementCheckResult {
  switch (type) {
    case "open_app":
      // Calling this authenticated endpoint at all already proves the app
      // is open and the user is logged in — nothing further to check.
      return { met: true, reason: "Satisfied by making this request while authenticated." };

    case "streak":
      return ctx.streakDays >= value
        ? { met: true, reason: `Streak is ${ctx.streakDays} days (needs ${value}).` }
        : { met: false, reason: `Streak is ${ctx.streakDays} days — needs ${value}.` };

    case "save_amount":
      return ctx.totalSaved >= value
        ? { met: true, reason: `Lifetime saved is ${ctx.totalSaved} (needs ${value}).` }
        : { met: false, reason: `Lifetime saved is ${ctx.totalSaved} — needs ${value}.` };

    case "complete_daily": {
      const count = ctx.dailyQuestsCompleted ?? 0;
      return count >= value
        ? { met: true, reason: `${count} daily quest(s) completed (needs ${value}).` }
        : { met: false, reason: `Only ${count} daily quest(s) completed — needs ${value}.` };
    }

    case "complete_quest": {
      if (requiresQuestId) {
        const done = ctx.completedQuestIds?.has(requiresQuestId) ?? false;
        return done
          ? { met: true, reason: `Quest "${requiresQuestId}" has been completed.` }
          : { met: false, reason: `Quest "${requiresQuestId}" has not been completed yet.` };
      }
      // No specific quest id — interpreted as "N goals completed" (see note above).
      const goalsCompleted = ctx.completedGoalsCount ?? 0;
      return goalsCompleted >= value
        ? { met: true, reason: `${goalsCompleted} goal(s) completed (needs ${value}).` }
        : { met: false, reason: `Only ${goalsCompleted} goal(s) completed — needs ${value}.` };
    }

    default:
      return { met: false, reason: `Unknown requirement type "${type}".` };
  }
}
