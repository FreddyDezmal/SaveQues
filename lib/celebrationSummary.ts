/**
 * lib/celebrationSummary.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 20 — Phase 8: Premium Celebrations.
 *
 * CelebrationOverlay (built in an earlier sprint, extended this sprint
 * with a `stats` prop + reduced-motion support) is presentation-only and
 * takes whatever stats it's given. This module is the "what to put in
 * those stats" logic — reusing lib/xp.ts and lib/analyticsEngine.ts
 * rather than recomputing level/streak/total-saved math a second time.
 *
 * Pure, deterministic, no UI — callers pass the result straight into
 * <CelebrationOverlay stats={...} />.
 */

import { getLevelFromXP } from "@/lib/xp";
import { getDepositStats, getDeposits } from "@/lib/analyticsEngine";
import type { Transaction } from "@/lib/types";

export interface CelebrationStat { label: string; value: string }

export interface CelebrationSummaryInputs {
  celebrationType: "goal" | "levelup" | "streak" | "achievement" | "badge" | "xp";
  xpTotal: number;
  streakDays: number;
  transactions: Transaction[];
  formatAmount: (n: number) => string;
  /** For goal-completion celebrations — the goal that was just completed. */
  completedGoal?: { title: string; target_amount: number };
}

/**
 * Builds a 2-4 item stat row appropriate to the celebration type. Goal
 * completions lead with what was saved; level-ups lead with the new level;
 * streak celebrations lead with the streak length. Every value here is a
 * real computed number — nothing is invented for the sake of filling a slot.
 */
export function buildCelebrationStats(inputs: CelebrationSummaryInputs): CelebrationStat[] {
  const { celebrationType, xpTotal, streakDays, transactions, formatAmount, completedGoal } = inputs;
  const level = getLevelFromXP(xpTotal);
  const deposits = getDeposits(transactions);
  const stats = getDepositStats(deposits);
  const totalSaved = stats?.total ?? 0;

  const levelStat: CelebrationStat = { label: "Level", value: String(level.level) };
  const streakStat: CelebrationStat = { label: "Streak", value: `${streakDays}d` };
  const totalStat: CelebrationStat = { label: "Total Saved", value: formatAmount(totalSaved) };

  switch (celebrationType) {
    case "goal":
      return [
        { label: "Goal Reached", value: completedGoal ? formatAmount(completedGoal.target_amount) : totalStat.value },
        totalStat,
        streakStat,
        levelStat,
      ];
    case "levelup":
      return [levelStat, totalStat, streakStat];
    case "streak":
      return [streakStat, totalStat, levelStat];
    case "achievement":
    case "badge":
      return [totalStat, streakStat];
    default:
      return [totalStat, levelStat];
  }
}
