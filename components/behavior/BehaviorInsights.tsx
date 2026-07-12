"use client";

/**
 * components/behavior/BehaviorInsights.tsx
 * ─────────────────────────────────────────────────────────────
 * Sprint 21 — Phase 10: Behavior Insights Component.
 *
 * Pure presentation over lib/habits.ts, lib/behaviorProfile.ts,
 * lib/riskEngine.ts, and lib/interventions.ts — no computation happens
 * here. Follows the same compact-card, collapsible-detail pattern as
 * components/goals/GoalIntelligenceCard.tsx (Sprint 19) and
 * components/insights/IntelligencePanel.tsx (Sprint 19/20) so it's visually
 * consistent with the rest of the intelligence UI rather than introducing
 * a new style.
 *
 * Automatically hides (`return null`) when there isn't enough evidence —
 * per the brief, this component never shows a placeholder or a guess.
 */

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { HabitProfile } from "@/lib/habits";
import type { BehaviorProfile } from "@/lib/behaviorProfile";
import type { BehavioralRisk } from "@/lib/riskEngine";
import type { Intervention } from "@/lib/interventions";

interface Props {
  habits: HabitProfile;
  behaviorProfile: BehaviorProfile;
  risk: BehavioralRisk;
  interventions: Intervention[];
}

const RISK_COLOR: Record<BehavioralRisk["riskLevel"], string> = {
  low: "text-emerald-400",
  moderate: "text-blue-400",
  elevated: "text-amber-400",
  high: "text-red-400",
};

export default function BehaviorInsights({ habits, behaviorProfile, risk, interventions }: Props) {
  const [expanded, setExpanded] = useState(false);

  // Insufficient evidence — per the brief, hide entirely rather than show a placeholder.
  if (!habits.hasEnoughData || !risk.hasEnoughData) return null;

  const topIntervention = interventions[0];
  const strongestHabit = habits.strongestSavingDay
    ? `${habits.strongestSavingDay.day}s`
    : habits.depositRhythm.type !== "irregular"
      ? `${habits.depositRhythm.type} rhythm`
      : null;

  return (
    <div className="card p-4 mb-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white/80">Habit Score {habits.habitScore}/100</span>
          <span className={`text-xs ${RISK_COLOR[risk.riskLevel]}`}>· {risk.riskLevel} risk</span>
        </div>
        {expanded ? <ChevronUp size={16} className="text-white/40" /> : <ChevronDown size={16} className="text-white/40" />}
      </button>

      <p className="text-sm text-white/70 mt-2 leading-snug">
        {behaviorProfile.profile}
        {strongestHabit && <span className="text-white/40"> · strongest habit: {strongestHabit}</span>}
      </p>

      {topIntervention && (
        <p className="text-sm text-white/60 mt-1.5 leading-snug">{topIntervention.title} — {topIntervention.reason}</p>
      )}

      {expanded && (
        <div className="mt-3 pt-3 border-t border-surface-border space-y-3">
          <div>
            <p className="text-white/40 text-[11px] uppercase tracking-wide mb-1">Behavioral profile</p>
            <p className="text-xs text-white/60">{behaviorProfile.explanation}</p>
          </div>

          {risk.factors.some((f) => f.triggered) && (
            <div>
              <p className="text-white/40 text-[11px] uppercase tracking-wide mb-1">Risk factors</p>
              <ul className="space-y-1">
                {risk.factors.filter((f) => f.triggered).map((f) => (
                  <li key={f.name} className="text-xs text-white/60">{f.name}: {f.explanation}</li>
                ))}
              </ul>
            </div>
          )}

          {interventions.length > 0 && (
            <div>
              <p className="text-white/40 text-[11px] uppercase tracking-wide mb-1">Recommended focus</p>
              <ul className="space-y-1.5">
                {interventions.map((i) => (
                  <li key={i.type} className="text-xs text-white/60">
                    <span className="text-white/80 font-medium">{i.title}</span> — {i.expectedBenefit}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
