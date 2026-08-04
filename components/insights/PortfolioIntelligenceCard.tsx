"use client";

/**
 * components/insights/PortfolioIntelligenceCard.tsx
 * ─────────────────────────────────────────────────────────────
 * Sprint 28.5 — Phase 5: Portfolio Intelligence (UI half).
 *
 * Every value here comes straight from lib/portfolioIntelligence.ts —
 * see that module's own docstring for what's genuinely new (strongest/
 * weakest goal, completion forecast, opportunity) versus what's a
 * pass-through of an existing engine (diversification from
 * categoryIntelligence, quarter projection from cashFlowProjection).
 */

import Link from "next/link";
import type { PortfolioIntelligence } from "@/lib/portfolioIntelligence";
import { formatDateLong } from "@/lib/dateFormat";

interface Props {
  data: PortfolioIntelligence;
  formatAmount: (n: number) => string;
}

function formatDate(iso: string): string {
  return formatDateLong(new Date(iso + "T00:00:00Z"));
}

export default function PortfolioIntelligenceCard({ data, formatAmount }: Props) {
  const hasAnyContent =
    data.strongestGoal || data.weakestGoal || data.completionForecast || data.opportunity || data.quarterProjection.projectedBalance !== null;
  if (!hasAnyContent) return null;

  return (
    <section className="card p-4 mb-4" aria-labelledby="portfolio-intelligence-heading">
      <h2 id="portfolio-intelligence-heading" className="text-white/55 text-xs uppercase tracking-wide mb-3">
        Portfolio Intelligence
      </h2>

      {(data.strongestGoal || data.weakestGoal) && (
        <div className="grid grid-cols-2 gap-3 mb-3 pb-3 border-b border-surface-border">
          {data.strongestGoal && (
            <div>
              <p className="text-[11px] text-white/55">Strongest goal</p>
              <p className="text-sm text-emerald-400 font-medium">{data.strongestGoal.title}</p>
              <p className="text-[11px] text-white/55 mt-0.5">{data.strongestGoal.score}/100</p>
            </div>
          )}
          {data.weakestGoal && data.weakestGoal.goalId !== data.strongestGoal?.goalId && (
            <div>
              <p className="text-[11px] text-white/55">Needs attention</p>
              <p className="text-sm text-amber-400 font-medium">{data.weakestGoal.title}</p>
              <p className="text-[11px] text-white/55 mt-0.5">{data.weakestGoal.explanation}</p>
            </div>
          )}
        </div>
      )}

      {data.quarterProjection.projectedBalance !== null && (
        <p className="text-xs text-white/60 mb-2">
          Projected portfolio balance in 90 days:{" "}
          <span className="text-white/90 font-medium">{formatAmount(data.quarterProjection.projectedBalance)}</span>
        </p>
      )}

      <p className="text-xs text-white/50 mb-2">{data.diversification.explanation}</p>

      {data.opportunity && (
        <p className="text-xs text-white/60 mb-1">
          💡 <span className="text-white/80 font-medium">{data.opportunity.title}</span> — {data.opportunity.reason}
        </p>
      )}

      {data.completionForecast && (
        <p className="text-xs text-white/55">
          At current pace, your last active goal ({data.completionForecast.title}) finishes around{" "}
          {formatDate(data.completionForecast.projectedCompletionDate)}.
        </p>
      )}

      {data.opportunity && (
        <Link href={`/goals/${data.opportunity.goalId}`} className="text-brand-400 text-xs hover:text-brand-300 mt-2 inline-block">
          View goal →
        </Link>
      )}
    </section>
  );
}
