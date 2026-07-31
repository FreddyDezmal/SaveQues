"use client";

/**
 * components/goals/GoalIntelligenceCard.tsx
 * ─────────────────────────────────────────────────────────────
 * Sprint 19 — Phase 9: Dashboard/Goal Integration.
 *
 * Renders the Phase 4 (forecast) + Phase 5 (goal health) + Phase 7
 * (coaching) output for a single goal. Pure presentation — all numbers are
 * computed by the caller (lib/forecast.ts, lib/goalHealth.ts,
 * lib/coaching.ts) via useMemo, this component just lays them out.
 * Deliberately compact: one card, collapsible detail, so it doesn't
 * compete with the existing progress card for attention (Phase 9 brief:
 * "avoid clutter, do not redesign").
 */

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { GoalForecast } from "@/lib/forecast";
import type { GoalHealth } from "@/lib/goalHealth";
import type { CoachingMessage } from "@/lib/coaching";

interface Props {
  forecast: GoalForecast;
  health: GoalHealth;
  coaching: CoachingMessage[];
  formatAmount: (n: number) => string;
}

const STATUS_COLOR: Record<GoalHealth["status"], string> = {
  Excellent: "text-emerald-400",
  Good: "text-blue-400",
  "Needs Attention": "text-amber-400",
  "At Risk": "text-red-400",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function GoalIntelligenceCard({ forecast, health, coaching, formatAmount }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (forecast.isComplete) return null;

  const topCoaching = coaching[0];

  return (
    <div className="card p-4 mb-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold ${STATUS_COLOR[health.status]}`}>{health.status}</span>
          <span className="text-white/30 text-xs">· Goal Health {health.score}/100</span>
        </div>
        {expanded ? <ChevronUp size={16} className="text-white/40" /> : <ChevronDown size={16} className="text-white/40" />}
      </button>

      {topCoaching && (
        <p className="text-sm text-white/70 mt-2 leading-snug">{topCoaching.message}</p>
      )}

      <div className="mt-2 text-sm text-white/60">
        {forecast.projectedCompletionDate ? (
          <span>
            Projected completion: <span className="text-white/90 font-medium">{formatDate(forecast.projectedCompletionDate)}</span>
            {forecast.currentWeeklyPace !== null && (
              <span className="text-white/40"> (at {formatAmount(forecast.currentWeeklyPace)}/week)</span>
            )}
          </span>
        ) : (
          <span className="text-white/40">{forecast.insufficientDataReason ?? "Not enough data yet to project a completion date."}</span>
        )}
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-surface-border space-y-3">
          {forecast.requiredWeeklyPace !== null && (
            <div className="text-xs text-white/50">
              Required pace to hit your target date: <span className="text-white/80">{formatAmount(forecast.requiredWeeklyPace)}/week</span>
              {" "}({formatAmount(forecast.requiredMonthlyPace ?? 0)}/month)
              <p className="text-[11px] text-white/55 mt-0.5">Assumes even weekly deposits from today until the target date — not a lump sum at the end.</p>
            </div>
          )}
          <div className="space-y-2">
            {health.factors.map((f) => (
              <div key={f.name}>
                <div className="flex justify-between text-xs">
                  <span className="text-white/50">{f.name}</span>
                  <span className="text-white/70">{f.points}/{f.maxPoints}</span>
                </div>
                {/* Sprint 28.5 — Phase 4/7: every score must answer "why".
                    goalHealth.ts has always computed this explanation per
                    factor; it just wasn't rendered anywhere until now. */}
                <p className="text-[11px] text-white/55 mt-0.5">{f.explanation}</p>
              </div>
            ))}
          </div>
          {coaching.length > 1 && (
            <ul className="space-y-1">
              {coaching.slice(1, 3).map((m) => (
                <li key={m.id} className="text-xs text-white/50">{m.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
