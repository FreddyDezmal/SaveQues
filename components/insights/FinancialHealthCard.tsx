"use client";

/**
 * components/insights/FinancialHealthCard.tsx
 * ─────────────────────────────────────────────────────────────
 * Sprint 28 — Phase 5/10/11: Financial Health Score + Cash Flow
 * Intelligence (UI half).
 *
 * Mirrors CategoryIntelligenceCard.tsx's philosophy (same file this card
 * sits next to on the dashboard): renders nothing without enough data,
 * text carries the information rather than colour alone, doesn't
 * reproduce accountHealth's own dashboard surface — this is presenting
 * lib/financialHealthScore.ts's 6-tier score specifically, a distinct
 * (documented) surface, not a restyle of the existing 4-band one.
 */

import type { FinancialHealthScore } from "@/lib/financialHealthScore";
import type { CashFlowProjection } from "@/lib/cashFlowProjection";

interface Props {
  healthScore: FinancialHealthScore | null;
  cashFlow: CashFlowProjection | null;
  formatAmount: (n: number) => string;
}

const TIER_COLOR: Record<FinancialHealthScore["tier"], string> = {
  Excellent: "text-emerald-400",
  Great: "text-teal-400",
  Healthy: "text-blue-400",
  Improving: "text-amber-400",
  "Needs Attention": "text-orange-400",
  Critical: "text-red-400",
};

export default function FinancialHealthCard({ healthScore, cashFlow, formatAmount }: Props) {
  if (!healthScore) return null;

  const topFactors = [...healthScore.factors].sort((a, b) => a.points / a.maxPoints - b.points / b.maxPoints).slice(0, 2);

  return (
    <section className="card p-4 mb-4" aria-labelledby="financial-health-heading">
      <div className="flex items-center justify-between mb-1">
        <h2 id="financial-health-heading" className="text-sm font-semibold text-white/90">
          Financial Health
        </h2>
        <span className="text-xs text-white/55">{healthScore.score}/100</span>
      </div>

      <p className={`text-lg font-semibold ${TIER_COLOR[healthScore.tier]}`}>{healthScore.tier}</p>

      {/* Text-equivalent bar, not colour-only — same convention as CategoryIntelligenceCard. */}
      <div
        className={`h-1.5 rounded-full bg-white/10 overflow-hidden mt-2 ${TIER_COLOR[healthScore.tier]}`}
        role="img"
        aria-label={`Financial health score: ${healthScore.score} out of 100, rated ${healthScore.tier}`}
      >
        <div className="h-full rounded-full bg-current" style={{ width: `${healthScore.score}%` }} />
      </div>

      {healthScore.recommendations[0] && (
        <p className="text-sm text-white/70 mt-3 leading-snug">{healthScore.recommendations[0]}</p>
      )}

      {topFactors.length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
          <p className="text-xs text-white/55 mb-1">Areas with the most room to improve</p>
          {topFactors.map((f) => (
            <div key={f.name}>
              <div className="flex justify-between text-xs">
                <span className="text-white/50">{f.name}</span>
                <span className="text-white/70">{f.points}/{f.maxPoints}</span>
              </div>
              {/* Sprint 28.5 — Phase 7: same explanation-dropping bug as
                  GoalIntelligenceCard and PortfolioClient's health block —
                  fixed all three the same way. */}
              <p className="text-[11px] text-white/55 mt-0.5">{f.explanation}</p>
            </div>
          ))}
        </div>
      )}

      {cashFlow && cashFlow.projectedAdditionalSavingsQuarter !== null && (
        <p className="text-xs text-white/50 mt-3 pt-3 border-t border-white/10">
          At your recent pace, projected to save an additional{" "}
          <span className="text-white/80">{formatAmount(cashFlow.projectedAdditionalSavingsQuarter)}</span> over the next 90 days.
        </p>
      )}
    </section>
  );
}
