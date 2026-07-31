/**
 * lib/cashFlowProjection.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 28 — Phase 10: Cash Flow Intelligence.
 *
 * AUDIT NOTE: lib/forecast.ts already projects pace and a completion date
 * PER GOAL. Nothing existing rolls that up to a portfolio-wide "how much
 * will I have saved, across everything, in 30/60/90 days" projection — the
 * genuine gap this file fills. It does so by reusing forecast.ts's own
 * `recentWeeklyPace()` (exported for this purpose — see that file's
 * comment) against ALL deposits rather than one goal's, so the portfolio
 * pace formula is provably the same formula already validated per-goal,
 * not a re-derivation.
 *
 * Deliberately excluded from scope (see docs/FINANCIAL_INTELLIGENCE.md):
 *   - No cash-flow-out modeling. This app has no expense/income tracking,
 *     only savings deposits/withdrawals per goal — "cash flow" here means
 *     "projected additional savings," not a full income/expense forecast.
 *   - Withdrawals ARE subtracted from `currentBalance` (a real balance
 *     figure must net them out) but are NOT subtracted from the pace
 *     projection — pace is deposit behaviour (analyticsEngine.getDeposits
 *     excludes withdrawals by design, see that file's own module comment).
 *     A user who is both depositing and withdrawing gets an honest current
 *     balance and an honest deposit pace; combining them into a single
 *     "net cash flow" pace would require assuming future withdrawal
 *     behaviour, which is exactly the kind of invented number this
 *     project's principles rule out.
 */

import { getDeposits, getDepositStats } from "@/lib/analyticsEngine";
import { recentWeeklyPace, PACE_WINDOW_WEEKS } from "@/lib/forecast";
import { sumGoalBalances } from "@/lib/utils";
import type { SavingsGoal, Transaction } from "@/lib/types";

export interface CashFlowProjection {
  /** Sum of every goal's current_amount — real money currently allocated to goals. */
  currentBalance: number;
  /** $/week, averaged over the most recent PACE_WINDOW_WEEKS weeks of ALL deposit activity. Null = not enough history. */
  weeklyPace: number | null;
  projectedAdditionalSavings30Day: number | null;
  projectedAdditionalSavings60Day: number | null;
  projectedAdditionalSavingsQuarter: number | null;
  projectedBalance30Day: number | null;
  projectedBalance60Day: number | null;
  projectedBalanceQuarter: number | null;
  /**
   * Active goals whose remaining amount is small enough to be covered by
   * the quarter's projected additional savings ON ITS OWN — i.e. "if you
   * pointed your current pace entirely at this one goal, you'd fund it
   * within 90 days." Deliberately NOT a claim that all listed goals could
   * be funded SIMULTANEOUSLY at that pace (that would double-count the
   * same projected dollars across goals) — see explanation string on each.
   */
  fundableWithinQuarter: { goalId: string; remaining: number }[];
  insufficientDataReason: string | null;
}

type GoalInput = Pick<SavingsGoal, "id" | "target_amount" | "current_amount" | "is_complete">;

const DAY_WINDOWS = { thirty: 30, sixty: 60, quarter: 90 } as const;

export function projectCashFlow(
  transactions: Transaction[],
  goals: GoalInput[],
  now: Date = new Date()
): CashFlowProjection {
  const currentBalance = sumGoalBalances(goals);
  const deposits = getDeposits(transactions);
  const weeklyPace = recentWeeklyPace(deposits, now);

  if (weeklyPace === null || weeklyPace <= 0) {
    return {
      currentBalance,
      weeklyPace,
      projectedAdditionalSavings30Day: null,
      projectedAdditionalSavings60Day: null,
      projectedAdditionalSavingsQuarter: null,
      projectedBalance30Day: null,
      projectedBalance60Day: null,
      projectedBalanceQuarter: null,
      fundableWithinQuarter: [],
      insufficientDataReason:
        deposits.length === 0
          ? `No deposits recorded yet, so a cash flow projection can't be made.`
          : `Recent deposits (last ${PACE_WINDOW_WEEKS} weeks) aren't showing a positive pace, so a forward projection can't be made.`,
    };
  }

  const additional30 = weeklyPace * (DAY_WINDOWS.thirty / 7);
  const additional60 = weeklyPace * (DAY_WINDOWS.sixty / 7);
  const additionalQuarter = weeklyPace * (DAY_WINDOWS.quarter / 7);

  const activeGoals = goals.filter((g) => !g.is_complete);
  const fundableWithinQuarter = activeGoals
    .map((g) => ({ goalId: g.id, remaining: Math.max(0, Number(g.target_amount) - Number(g.current_amount)) }))
    .filter((g) => g.remaining > 0 && g.remaining <= additionalQuarter)
    .sort((a, b) => a.remaining - b.remaining);

  return {
    currentBalance,
    weeklyPace,
    projectedAdditionalSavings30Day: additional30,
    projectedAdditionalSavings60Day: additional60,
    projectedAdditionalSavingsQuarter: additionalQuarter,
    projectedBalance30Day: currentBalance + additional30,
    projectedBalance60Day: currentBalance + additional60,
    projectedBalanceQuarter: currentBalance + additionalQuarter,
    fundableWithinQuarter,
    insufficientDataReason: null,
  };
}

/** Convenience: total lifetime deposited, reused rather than recomputed for callers that already need both. */
export function lifetimeDeposited(transactions: Transaction[]): number {
  return getDepositStats(getDeposits(transactions))?.total ?? 0;
}
