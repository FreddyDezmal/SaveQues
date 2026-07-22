"use client";

/**
 * components/insights/CategoryIntelligenceCard.tsx
 * ─────────────────────────────────────────────────────────────
 * Sprint 24 — Phase 8: Category Intelligence.
 *
 * Deliberately mirrors IntelligencePanel.tsx's philosophy: renders
 * nothing when there isn't enough data, keeps to a handful of numbers
 * rather than the full per-category breakdown, and never uses the word
 * "abandoned" in user-facing copy — lib/categoryIntelligence.ts's
 * likelyStalledCount is a 60-day-inactivity heuristic, not a certainty
 * (see that file's header), and Sprint 23's product philosophy ("never
 * shame users") still applies here even though this is a Sprint 24
 * module. "Could use a little attention" is chosen deliberately over
 * "stalled"/"abandoned" for the same reason.
 */

import type { CategoryIntelligence } from "@/lib/categoryIntelligence";

interface Props {
  data: CategoryIntelligence | null;
  formatAmount: (n: number) => string;
}

export default function CategoryIntelligenceCard({ data, formatAmount }: Props) {
  if (!data) return null;

  const topCategories = [...data.categories]
    .filter((c) => c.totalSaved > 0)
    .sort((a, b) => b.totalSaved - a.totalSaved)
    .slice(0, 3);

  if (topCategories.length === 0) return null;

  const maxSaved = topCategories[0].totalSaved;
  const fastest = data.categories.find((c) => c.categoryId === data.fastestCompletingCategory);
  const needsAttention = data.categories.find((c) => c.categoryId === data.mostStalledCategory);

  return (
    <section className="card p-4 mb-4" aria-labelledby="category-intelligence-heading">
      <h2 id="category-intelligence-heading" className="text-sm font-semibold text-white/90 mb-3">
        Where your savings go
      </h2>

      {/* Text-equivalent list, not a colour-only chart — bars are decorative,
          the numbers themselves carry the information (accessibility: no
          reliance on colour alone, per this app's established convention
          in lib/heatmap.ts's text-summary requirement). */}
      <ul className="space-y-2.5">
        {topCategories.map((c) => (
          <li key={c.categoryId} className="flex items-center gap-3">
            <span className="text-lg" aria-hidden="true">{c.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-sm text-white/85 truncate">{c.label}</span>
                <span className="text-sm text-white/60 tabular-nums whitespace-nowrap">
                  {formatAmount(c.totalSaved)} · {Math.round(c.percentOfTotalSaved)}%
                </span>
              </div>
              <div
                className="h-1.5 rounded-full bg-white/10 overflow-hidden"
                role="img"
                aria-label={`${c.label}: ${formatAmount(c.totalSaved)}, ${Math.round(c.percentOfTotalSaved)} percent of total savings`}
              >
                <div
                  className="h-full rounded-full"
                  style={{ width: `${maxSaved > 0 ? (c.totalSaved / maxSaved) * 100 : 0}%`, backgroundColor: c.color }}
                />
              </div>
            </div>
          </li>
        ))}
      </ul>

      {(fastest || needsAttention) && (
        <div className="mt-3 pt-3 border-t border-white/10 space-y-1.5">
          {fastest && fastest.medianDaysToComplete !== null && (
            <p className="text-xs text-white/60">
              <span aria-hidden="true">{fastest.icon} </span>
              {fastest.label} goals tend to finish fastest — around {Math.round(fastest.medianDaysToComplete)} days.
            </p>
          )}
          {needsAttention && needsAttention.likelyStalledCount > 0 && (
            <p className="text-xs text-white/60">
              <span aria-hidden="true">{needsAttention.icon} </span>
              You have {needsAttention.likelyStalledCount} {needsAttention.label.toLowerCase()} goal
              {needsAttention.likelyStalledCount === 1 ? "" : "s"} that could use a little attention.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
