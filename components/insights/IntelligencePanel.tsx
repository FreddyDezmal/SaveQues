"use client";

/**
 * components/insights/IntelligencePanel.tsx
 * ─────────────────────────────────────────────────────────────
 * Sprint 19 — Phase 9: Dashboard Integration.
 *
 * Deliberately small: one card showing the single most relevant insight,
 * the top coaching message, and a one-line weekly-savings summary. Per the
 * Phase 9 brief ("avoid clutter... do not redesign the dashboard") this
 * does not attempt to surface every Phase 2-7 number — it's an entry point;
 * users who want the full breakdown get it on the goal detail page via
 * GoalIntelligenceCard.
 *
 * Renders nothing (returns null) when there isn't enough data yet, rather
 * than showing an empty or placeholder card.
 */

import type { Insight } from "@/lib/insights";
import type { WeeklyReview } from "@/lib/weeklyReview";
import type { DashboardSection } from "@/lib/dashboardPersonalization";

interface Props {
  insights: Insight[];
  weeklyReview: WeeklyReview | null;
  topCoachingMessage: string | null;
  formatAmount: (n: number) => string;
  /**
   * Sprint 20 — Phase 4: the user's full personalized section order (from
   * lib/dashboardPersonalization.ts). This panel only cares about the
   * relative order of "insights" / "coaching" / "weekly_review" within it —
   * everything else in the list is for sections outside this panel.
   */
  sectionOrder?: DashboardSection[];
}

type Block = "insights" | "coaching" | "weekly_review";

export default function IntelligencePanel({ insights, weeklyReview, topCoachingMessage, formatAmount, sectionOrder }: Props) {
  const topInsight = insights[0];
  const hasWeeklyData = weeklyReview?.hasEnoughData;

  if (!topInsight && !topCoachingMessage && !hasWeeklyData) return null;

  // Order the three blocks by where they fall in the personalized section
  // order; blocks not present in `sectionOrder` (e.g. "coaching" simply
  // wasn't prioritized for this stage) keep their existing relative
  // position at the end, in the original insight → coaching → weekly order.
  const relevant: Block[] = ["insights", "coaching", "weekly_review"];
  const order = sectionOrder ?? [];
  const blockOrder = [...relevant].sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai === -1 && bi === -1) return relevant.indexOf(a) - relevant.indexOf(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  const renderBlock = (block: Block) => {
    if (block === "insights" && topInsight) {
      return <p key="insights" className="text-sm text-white/90 mb-1.5 leading-snug">{topInsight.message}</p>;
    }
    if (block === "coaching" && topCoachingMessage) {
      return <p key="coaching" className="text-sm text-white/60 mb-1.5 leading-snug">{topCoachingMessage}</p>;
    }
    if (block === "weekly_review" && hasWeeklyData && weeklyReview) {
      return (
        <div key="weekly_review" className="flex items-center gap-2 mt-2 pt-2 border-t border-surface-border text-xs text-white/50">
          <span>
            This week: <span className="text-white/80 font-medium">{formatAmount(weeklyReview.weeklySavings)}</span>
          </span>
          {weeklyReview.changeFromPreviousWeek.percent !== null && (
            <span className={weeklyReview.changeFromPreviousWeek.direction === "up" ? "text-emerald-400" : "text-white/40"}>
              {weeklyReview.changeFromPreviousWeek.direction === "up" ? "▲" : weeklyReview.changeFromPreviousWeek.direction === "down" ? "▼" : "–"}
              {" "}
              {Math.abs(Math.round(weeklyReview.changeFromPreviousWeek.percent))}% vs last week
            </span>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="card p-4 mb-4">
      <p className="text-white/40 text-xs mb-2 uppercase tracking-wide">Your saving insights</p>
      {blockOrder.map(renderBlock)}
    </div>
  );
}
