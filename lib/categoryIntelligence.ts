/**
 * lib/categoryIntelligence.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 24 — Phase 8: Category Intelligence.
 *
 * Answers the three questions the brief asks for, per goal category
 * (GOAL_CATEGORIES in lib/utils.ts — the same 12-category enum already
 * enforced by the savings_goals_category_check DB constraint, migration
 * 025 — no new category taxonomy invented here):
 *   - Which categories receive the most savings?
 *   - Which categories are completed fastest?
 *   - Which categories are abandoned most often?
 *
 * Reuses rather than duplicates:
 *   - getDeposits() / Deposit type            — lib/analyticsEngine.ts
 *   - getGoalCompletionTimestamp()            — lib/analyticsEngine.ts
 *     (same proxy lib/timeline.ts uses for "when was this goal finished")
 *   - utcDaysBetween()                        — lib/dateUtils.ts
 *   - GOAL_CATEGORIES / getCategoryById()     — lib/utils.ts
 *
 * HONEST LIMITATION — "abandoned" categories:
 *   savings_goals has no status/archived/deleted_at column — only
 *   `is_complete: boolean` (see lib/types.ts). There is no way to
 *   directly ask the database "was this goal abandoned?" the way you
 *   can ask "was it completed?". Rather than skip the question or
 *   silently invent a fake signal, this file defines a documented
 *   heuristic — `isLikelyStalled()` below — and labels every output
 *   from it "likely stalled", never "abandoned", so nothing this
 *   module produces overstates its own certainty. The real fix is a
 *   schema addition (an explicit goal status/lifecycle column); that's
 *   called out again in the module-level TODO at the bottom rather
 *   than worked around silently.
 */

import type { SavingsGoal, Transaction } from "@/lib/types";
import { getDeposits, getGoalCompletionTimestamp } from "@/lib/analyticsEngine";
import { utcDaysBetween } from "@/lib/dateUtils";
import { GOAL_CATEGORIES, getCategoryById, type GoalCategory } from "@/lib/utils";

// A goal with no deposit in this many days, that isn't complete, is
// treated as "likely stalled" for the abandonment-rate heuristic below.
// 60 days was chosen to comfortably exceed even a monthly saving cadence
// (see lib/analyticsEngine.ts's "average deposits per month" scale)
// without flagging goals that are simply being funded less frequently
// by design (e.g. a multi-year investment goal with quarterly top-ups
// would need a longer window in practice — see the module TODO).
const STALLED_INACTIVITY_DAYS = 60;

export interface CategoryStats {
  categoryId: GoalCategory;
  label: string;
  icon: string;
  color: string;

  goalCount: number;
  activeGoalCount: number;
  completedGoalCount: number;
  likelyStalledCount: number;

  totalSaved: number;
  /** 0–100, this category's share of the user's total deposits across all categories. */
  percentOfTotalSaved: number;
  depositCount: number;

  /** Median days from goal creation to its (proxy) completion timestamp, across this category's completed goals. Null if none completed yet. */
  medianDaysToComplete: number | null;
}

export interface CategoryIntelligence {
  categories: CategoryStats[];
  /** categoryId of the category with the highest totalSaved, or null if the user has no deposits at all. */
  topSavingCategory: GoalCategory | null;
  /** categoryId with the lowest medianDaysToComplete among categories with at least one completed goal, or null. */
  fastestCompletingCategory: GoalCategory | null;
  /** categoryId with the highest likelyStalledCount (ties broken by category order), or null if nothing looks stalled. */
  mostStalledCategory: GoalCategory | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * See the "HONEST LIMITATION" note in the file header. A goal counts as
 * likely stalled if it isn't complete AND its most recent transaction
 * (or creation, if it has none) is more than STALLED_INACTIVITY_DAYS old.
 */
export function isLikelyStalled(
  goal: Pick<SavingsGoal, "id" | "created_at" | "is_complete">,
  transactions: Transaction[],
  now: Date = new Date()
): boolean {
  if (goal.is_complete) return false;
  const lastActivity = getGoalCompletionTimestamp(goal, transactions); // reused as "most recent activity, or created_at" — see its own docstring
  return utcDaysBetween(new Date(lastActivity), now) > STALLED_INACTIVITY_DAYS;
}

/**
 * Builds the full category breakdown for one user. Pure — no I/O, no
 * hidden Date.now() (now defaults but is overridable for tests), so
 * this is unit-testable the same way lib/analyticsEngine.ts's functions
 * are.
 */
export function computeCategoryIntelligence(
  goals: SavingsGoal[],
  transactions: Transaction[],
  now: Date = new Date()
): CategoryIntelligence {
  const deposits = getDeposits(transactions);
  const grandTotalSaved = deposits.reduce((sum, d) => sum + Number(d.amount), 0);

  const categories: CategoryStats[] = GOAL_CATEGORIES.map((catDef) => {
    const categoryGoals = goals.filter((g) => g.category === catDef.id);
    const goalIds = new Set(categoryGoals.map((g) => g.id));
    const categoryDeposits = deposits.filter((d) => goalIds.has(d.goal_id));

    const totalSaved = categoryDeposits.reduce((sum, d) => sum + Number(d.amount), 0);
    const completedGoals = categoryGoals.filter((g) => g.is_complete);
    const daysToComplete = completedGoals.map((g) =>
      utcDaysBetween(new Date(g.created_at), new Date(getGoalCompletionTimestamp(g, transactions)))
    );

    return {
      categoryId: catDef.id,
      label: catDef.label,
      icon: catDef.icon,
      color: catDef.color,

      goalCount: categoryGoals.length,
      activeGoalCount: categoryGoals.filter((g) => !g.is_complete).length,
      completedGoalCount: completedGoals.length,
      likelyStalledCount: categoryGoals.filter((g) => isLikelyStalled(g, transactions, now)).length,

      totalSaved,
      percentOfTotalSaved: grandTotalSaved > 0 ? (totalSaved / grandTotalSaved) * 100 : 0,
      depositCount: categoryDeposits.length,

      medianDaysToComplete: median(daysToComplete),
    };
  });

  const withSavings = categories.filter((c) => c.totalSaved > 0);
  const topSavingCategory =
    withSavings.length > 0
      ? withSavings.reduce((best, c) => (c.totalSaved > best.totalSaved ? c : best)).categoryId
      : null;

  const withCompletions = categories.filter((c) => c.medianDaysToComplete !== null);
  const fastestCompletingCategory =
    withCompletions.length > 0
      ? withCompletions.reduce((best, c) => (c.medianDaysToComplete! < best.medianDaysToComplete! ? c : best)).categoryId
      : null;

  const withStalled = categories.filter((c) => c.likelyStalledCount > 0);
  const mostStalledCategory =
    withStalled.length > 0
      ? withStalled.reduce((worst, c) => (c.likelyStalledCount > worst.likelyStalledCount ? c : worst)).categoryId
      : null;

  return { categories, topSavingCategory, fastestCompletingCategory, mostStalledCategory };
}

// TODO(schema): "likely stalled" is a 60-day-inactivity heuristic because
// savings_goals has no explicit status/lifecycle column. If Sprint 25's
// AI Coach (per the Sprint 24 brief, the next sprint) wants to reason
// about abandonment more precisely — e.g. distinguishing "stalled" from
// "intentionally paused" from "slow multi-year goal by design" — the
// real fix is adding a `status` enum column (active/paused/abandoned/
// complete) set explicitly by the user or by an admin/support action,
// not a longer inference window. Flagging now rather than after Sprint
// 25 builds on top of this heuristic.
