/**
 * lib/journeyHighlights.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 19 — Phase 8: Financial Journey Timeline (highlights layer).
 *
 * lib/timeline.ts (built in an earlier sprint) already generates the core
 * event stream — deposits, withdrawals, goal lifecycle, achievements,
 * quests, progress milestones — grouped by date. Rewriting it would
 * violate the "never rewrite working systems" rule, so this module adds
 * the handful of Phase 8 event kinds it doesn't cover (account created,
 * first deposit, level ups, highest deposit, round-number savings
 * milestones) as a separate, reusable "highlights" list that callers can
 * merge with lib/timeline.ts output or show on its own (e.g. a condensed
 * "milestones" view). It intentionally does not reuse TimelineEventType
 * from lib/types.ts — extending that shared union would ripple into every
 * existing timeline consumer for a feature that's additive, not core.
 */

import { getDeposits } from "@/lib/analyticsEngine";
import { getLevelFromXP } from "@/lib/xp";
import type { Profile, SavingsGoal, Transaction } from "@/lib/types";

export type JourneyHighlightType =
  | "account_created"
  | "first_deposit"
  | "first_goal"
  | "level_up"
  | "highest_deposit"
  | "round_number_milestone";

export interface JourneyHighlight {
  id: string;
  type: JourneyHighlightType;
  timestamp: string;
  label: string;
}

const ROUND_NUMBER_STEP = 1000; // e.g. R1,000 / R2,000 ... crossed in *total saved*

export interface JourneyHighlightInputs {
  profile: Pick<Profile, "created_at" | "xp_total">;
  goals: Pick<SavingsGoal, "id" | "title" | "created_at">[];
  transactions: Transaction[];
}

export function buildJourneyHighlights({ profile, goals, transactions }: JourneyHighlightInputs): JourneyHighlight[] {
  const highlights: JourneyHighlight[] = [];

  // ── Account created ──────────────────────────────────────────────────────
  highlights.push({
    id: "account_created",
    type: "account_created",
    timestamp: profile.created_at,
    label: "Joined SaveQuest",
  });

  // ── First goal ────────────────────────────────────────────────────────────
  const earliestGoal = goals.slice().sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];
  if (earliestGoal) {
    highlights.push({
      id: `first_goal_${earliestGoal.id}`,
      type: "first_goal",
      timestamp: earliestGoal.created_at,
      label: `Created your first goal: "${earliestGoal.title}"`,
    });
  }

  // ── First deposit / highest deposit / round-number milestones ──────────────
  const deposits = getDeposits(transactions);
  if (deposits.length > 0) {
    const first = deposits[0];
    highlights.push({
      id: `first_deposit_${first.id}`,
      type: "first_deposit",
      timestamp: first.created_at,
      label: "Made your first deposit",
    });

    let highest = deposits[0];
    for (const d of deposits) if (Number(d.amount) > Number(highest.amount)) highest = d;
    highlights.push({
      id: `highest_deposit_${highest.id}`,
      type: "highest_deposit",
      timestamp: highest.created_at,
      label: `Highest single deposit so far: ${Number(highest.amount).toLocaleString()}`,
    });

    // Walk deposits in order, tracking running total, and record the
    // transaction that first crosses each ROUND_NUMBER_STEP threshold.
    let running = 0;
    let nextThreshold = ROUND_NUMBER_STEP;
    for (const d of deposits) {
      running += Number(d.amount);
      while (running >= nextThreshold) {
        highlights.push({
          id: `round_${nextThreshold}`,
          type: "round_number_milestone",
          timestamp: d.created_at,
          label: `Passed ${nextThreshold.toLocaleString()} saved in total`,
        });
        nextThreshold += ROUND_NUMBER_STEP;
      }
    }
  }

  // ── Level ups ─────────────────────────────────────────────────────────────
  // The XP log needed to timestamp *when* each level-up happened isn't
  // stored (only the current xp_total is). Rather than fabricate a date,
  // this reports the current level as a highlight anchored to "now" and
  // documents the gap so a future sprint can add proper level-up timestamps
  // if an xp_log table is introduced.
  const levelInfo = getLevelFromXP(profile.xp_total);
  if (levelInfo.level > 1) {
    highlights.push({
      id: `current_level_${levelInfo.level}`,
      type: "level_up",
      timestamp: new Date().toISOString(),
      label: `Currently Level ${levelInfo.level}`,
    });
  }

  return highlights.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}
