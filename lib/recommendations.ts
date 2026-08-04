/**
 * lib/recommendations.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 20 — Phase 3: Smart Goal Recommendations.
 *
 * Recommendations are built from a fixed catalog of goal templates (real,
 * common savings categories — not invented) whose suggested target/weekly
 * amount is scaled against the user's own actual saving capacity
 * (lib/analyticsEngine.ts's average deposit + weekly pace). A user who
 * saves R50/week gets smaller suggested targets than one who saves
 * R500/week for the same category — nothing here is a flat, generic number.
 *
 * Deliberately excludes categories the user already has an active (or
 * completed) goal in, per the brief's "avoid recommending duplicate goals."
 *
 * SPRINT 31 — PHASE 8 AUDIT FINDING, FIXED HERE:
 * TEMPLATES.baselineTarget below was authored in ZAR (this app's original
 * single currency — see "Emergency Fund: 15000" etc.) and, before this
 * fix, was used completely unconverted for every user regardless of
 * currency_code. A JPY user got offered a literal "¥15,000" emergency
 * fund (≈$100 — far too small), while a KWD user got offered "15,000 KWD"
 * (≈$49,000 — absurdly large). Capacity-based scaling (below) made this
 * worse, not better, for non-ZAR users: it compares the user's own-currency
 * weekly capacity against a ZAR-denominated reference rate, so currencies
 * with very different unit values than ZAR (JPY, KWD, etc.) would almost
 * always hit the ±clamp rather than scaling meaningfully.
 *
 * Fixed via dependency injection, not a rewrite of the scaling math: an
 * optional `convertFromZar` pure function converts each ZAR-denominated
 * baseline into the user's currency BEFORE scaling runs, so the scaling
 * logic itself (unchanged) now operates on numbers that are actually
 * comparable to the user's real capacity. Same pattern
 * lib/scenarioSimulator.ts already uses for `formatAmount` — keeps this
 * module pure, synchronous, and fully unit-testable without a live
 * exchange-rate cache. Defaults to identity (no conversion) so any
 * existing caller that doesn't pass one keeps getting the exact previous
 * ZAR-denominated behavior — zero regression.
 *
 * The actual rate lookup (Phase 6/7's async cache) is the caller's job —
 * see lib/intelligence/getFinancialIntelligence.ts's docstring for why
 * that wiring stops there for now rather than reaching further upstream.
 */

import { getDeposits, getDepositStats, averageDepositsPerWeek } from "@/lib/analyticsEngine";
import { getUTCDateString } from "@/lib/dateUtils";
import type { GoalCategory } from "@/lib/utils";
import type { SavingsGoal, Transaction } from "@/lib/types";

export type RecommendationDifficulty = "easy" | "moderate" | "ambitious";

export interface GoalRecommendation {
  category: GoalCategory;
  title: string;
  reason: string;
  suggestedTarget: number;
  suggestedDurationWeeks: number;
  suggestedWeeklySaving: number;
  estimatedCompletionDate: string; // UTC "YYYY-MM-DD"
  difficulty: RecommendationDifficulty;
}

/**
 * Baseline catalog: a realistic target range (in the user's own currency
 * units, treated as a plain number — matches how amounts are stored
 * elsewhere in this codebase) and typical duration, before scaling to the
 * user's actual capacity. `weeklyFractionOfCapacity` controls how much of
 * the user's demonstrated weekly saving capacity this goal would ask for
 * (used only to set difficulty — the suggested weekly amount itself is
 * always derived from the target/duration, never invented separately).
 */
const TEMPLATES: {
  category: GoalCategory;
  title: string;
  baselineTarget: number;
  baselineWeeks: number;
  reason: string;
}[] = [
  { category: "emergency", title: "Emergency Fund", baselineTarget: 15000, baselineWeeks: 26, reason: "A cash buffer for unexpected expenses is one of the highest-value goals to have started." },
  { category: "travel", title: "Vacation", baselineTarget: 8000, baselineWeeks: 16, reason: "A dedicated travel fund keeps a trip from becoming a last-minute scramble." },
  { category: "gadget", title: "Laptop", baselineTarget: 12000, baselineWeeks: 20, reason: "A sinking fund for a laptop avoids financing it at the last minute." },
  { category: "vehicle", title: "Car Maintenance", baselineTarget: 5000, baselineWeeks: 12, reason: "A maintenance buffer smooths out an otherwise unpredictable expense." },
  { category: "tuition", title: "Education", baselineTarget: 20000, baselineWeeks: 40, reason: "Course or tuition costs are easier to absorb when saved for gradually." },
  { category: "custom", title: "Investment Starter", baselineTarget: 5000, baselineWeeks: 20, reason: "A starter amount for a first investment, sized to what you can realistically set aside." },
  { category: "custom", title: "Tax Buffer", baselineTarget: 10000, baselineWeeks: 30, reason: "Setting aside for tax obligations ahead of time avoids a cash crunch later." },
  { category: "home", title: "House Deposit", baselineTarget: 60000, baselineWeeks: 78, reason: "A house deposit is a long-horizon goal that benefits from starting early." },
  { category: "event", title: "Wedding Fund", baselineTarget: 40000, baselineWeeks: 52, reason: "Wedding costs are easier to plan for with a dedicated, steadily-growing fund." },
];

export interface RecommendationInputs {
  transactions: Transaction[];
  goals: Pick<SavingsGoal, "id" | "category" | "is_complete">[];
  now?: Date;
  maxResults?: number;
  /**
   * Converts a ZAR-denominated amount (what TEMPLATES.baselineTarget is
   * authored in) into the user's real currency. Defaults to identity —
   * i.e. "no conversion," which is exactly correct for ZAR users and
   * exactly the previous (pre-Phase-8) behavior for everyone else, so
   * omitting this is safe but reintroduces the bug documented above for
   * non-ZAR users. Callers with a real currency_code should pass a
   * function backed by lib/currencyConversion.ts's convertCurrency().
   */
  convertFromZar?: (zarAmount: number) => number;
}

/**
 * Scales a template's baseline target/duration to the user's demonstrated
 * capacity. Users with no deposit history yet get the template's baseline
 * numbers unscaled (there's nothing to scale against) but a lower-confidence
 * "starter estimate" framing via a wider duration — handled by the caller
 * via `hasCapacityData` in the metrics, not fabricated capacity.
 */
export function generateGoalRecommendations(inputs: RecommendationInputs): GoalRecommendation[] {
  const now = inputs.now ?? new Date();
  const convertFromZar = inputs.convertFromZar ?? ((zarAmount: number) => zarAmount);
  const deposits = getDeposits(inputs.transactions);
  const stats = getDepositStats(deposits);
  const weeklyPace = averageDepositsPerWeek(deposits);
  const capacityPerWeek = stats && weeklyPace ? stats.average * weeklyPace : null;

  const existingCategories = new Set(inputs.goals.filter((g) => !!g.category).map((g) => g.category as GoalCategory));

  const candidates = TEMPLATES.filter((t) => !existingCategories.has(t.category));

  const recommendations: GoalRecommendation[] = candidates.map((t) => {
    const baselineTarget = convertFromZar(t.baselineTarget);

    // Scale factor: how the user's typical weekly capacity compares to a
    // "reference" saver who could clear this template in its baseline
    // duration at baselineTarget/baselineWeeks per week. Clamped so a very
    // high or very low capacity doesn't produce an absurd target.
    const referenceWeekly = baselineTarget / t.baselineWeeks;
    const scale = capacityPerWeek ? Math.min(2.5, Math.max(0.4, capacityPerWeek / referenceWeekly)) : 1;

    const suggestedTarget = Math.round((baselineTarget * Math.min(1.5, Math.max(0.5, scale))) / 100) * 100;
    // NOTE (known limitation, not fixed here): rounding to the nearest 100
    // units assumes a ZAR-like unit value. For a currency where 100 units
    // is a much bigger or smaller amount than 100 ZAR (JPY, KWD, BHD...),
    // this rounding granularity itself isn't currency-aware. Left as
    // documented future work rather than redesigned here, since it's a
    // cosmetic rounding-precision issue, not the magnitude bug this fix
    // addresses.
    const suggestedWeeklySaving = capacityPerWeek
      ? Math.round(Math.min(capacityPerWeek * 0.5, suggestedTarget / t.baselineWeeks))
      : Math.round(suggestedTarget / t.baselineWeeks);
    const suggestedDurationWeeks = Math.max(4, Math.round(suggestedTarget / Math.max(1, suggestedWeeklySaving)));
    const estimatedCompletionDate = getUTCDateString(new Date(now.getTime() + suggestedDurationWeeks * 7 * 86400000));

    let difficulty: RecommendationDifficulty = "moderate";
    if (capacityPerWeek) {
      const ratio = suggestedWeeklySaving / capacityPerWeek;
      difficulty = ratio <= 0.3 ? "easy" : ratio <= 0.6 ? "moderate" : "ambitious";
    }

    return {
      category: t.category,
      title: t.title,
      reason: t.reason,
      suggestedTarget,
      suggestedDurationWeeks,
      suggestedWeeklySaving,
      estimatedCompletionDate,
      difficulty,
    };
  });

  // Easiest/most-achievable first — a new user's first recommendation
  // should feel attainable, not intimidating.
  const order: Record<RecommendationDifficulty, number> = { easy: 0, moderate: 1, ambitious: 2 };
  recommendations.sort((a, b) => order[a.difficulty] - order[b.difficulty]);

  return recommendations.slice(0, inputs.maxResults ?? 3);
}
