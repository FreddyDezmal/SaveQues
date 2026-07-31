"use client";

/**
 * components/insights/RecommendedGoalCard.tsx
 * ─────────────────────────────────────────────────────────────
 * Sprint 28.5 — Phase 3: Dashboard Intelligence — "Recommended Goal" widget.
 *
 * lib/recommendations.ts (Sprint 20 — Phase 3) was fully built and
 * documented but never actually called from any page — confirmed by
 * grepping for its import across app/ and components/ before writing this
 * file. This card is that missing wiring, not new logic: every number
 * shown here (suggested target, weekly saving, difficulty, completion
 * date) comes straight from `GoalRecommendation`, computed by
 * lib/recommendations.ts and passed through unchanged by
 * lib/intelligence/getFinancialIntelligence.ts.
 *
 * Shows only the single top recommendation (not the full list of up to 3
 * the engine can return) — per the Sprint 28.5 brief's "avoid dashboard
 * overload," one clear next action beats a mini-catalog. Renders nothing
 * when there's nothing to recommend (e.g. the user already has an active
 * or completed goal in every template category).
 */

import Link from "next/link";
import { getCategoryById } from "@/lib/utils";
import type { GoalRecommendation } from "@/lib/recommendations";

interface Props {
  recommendations: GoalRecommendation[];
  formatAmount: (n: number) => string;
}

const DIFFICULTY_LABEL: Record<GoalRecommendation["difficulty"], string> = {
  easy: "Easy fit for your pace",
  moderate: "Moderate stretch",
  ambitious: "Ambitious",
};

const DIFFICULTY_COLOR: Record<GoalRecommendation["difficulty"], string> = {
  easy: "text-emerald-400",
  moderate: "text-amber-400",
  ambitious: "text-orange-400",
};

export default function RecommendedGoalCard({ recommendations, formatAmount }: Props) {
  const top = recommendations[0];
  if (!top) return null;

  const category = getCategoryById(top.category);

  return (
    <section className="card p-4 mb-4" aria-labelledby="recommended-goal-heading">
      <div className="flex items-center justify-between mb-1">
        <h2 id="recommended-goal-heading" className="text-sm font-semibold text-white/90">
          Recommended Goal
        </h2>
        <span className={`text-xs ${DIFFICULTY_COLOR[top.difficulty]}`}>{DIFFICULTY_LABEL[top.difficulty]}</span>
      </div>

      <p className="text-lg font-semibold text-white/90 flex items-center gap-2">
        <span aria-hidden="true">{category.icon}</span>
        {top.title}
      </p>

      <p className="text-sm text-white/70 mt-1 leading-snug">{top.reason}</p>

      <div className="mt-3 pt-3 border-t border-white/10 grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-white/55">Suggested target</p>
          <p className="text-white/80">{formatAmount(top.suggestedTarget)}</p>
        </div>
        <div>
          <p className="text-white/55">Suggested weekly</p>
          <p className="text-white/80">{formatAmount(top.suggestedWeeklySaving)}/week</p>
        </div>
      </div>

      <Link
        href="/goals/new"
        className="btn-primary mt-3 inline-flex items-center justify-center w-full text-sm"
      >
        Start this goal
      </Link>
    </section>
  );
}
