"use client";

import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { StatCard } from "@/app/(app)/dashboard/DashboardClient";
import type { PortfolioSummary } from "@/lib/portfolioSummary";
import type { CashFlowProjection } from "@/lib/cashFlowProjection";
import type { GoalRecommendation } from "@/lib/recommendations";

interface Props {
  summary: PortfolioSummary;
  currencyCode: string;
  locale: string;
  /** Sprint 28.5 — Phase 5: portfolio-wide quarter cash-flow projection. Null when there isn't enough deposit history yet. */
  cashFlow: CashFlowProjection | null;
  /** Sprint 28.5 — Phase 5: highest-priority suggested next goal. Null only if the user already has a goal in every category. */
  topRecommendation: GoalRecommendation | null;
}

const HEALTH_COLOR: Record<string, string> = {
  Excellent: "text-emerald-400",
  Good: "text-blue-400",
  "Needs Attention": "text-amber-400",
  "At Risk": "text-red-400",
};

const DIFFICULTY_LABEL: Record<GoalRecommendation["difficulty"], string> = {
  easy: "Easy fit",
  moderate: "Moderate stretch",
  ambitious: "Ambitious",
};

export default function PortfolioClient({ summary, currencyCode, locale, cashFlow, topRecommendation }: Props) {
  const fc = (n: number) => formatCurrency(n, currencyCode, locale);

  return (
    <div className="max-w-md mx-auto px-4 pt-6 pb-24">
      <div className="flex items-center gap-3 mb-5">
        <Link href="/dashboard" className="p-2 -ml-2 rounded-xl text-white/40 hover:text-white/70 hover:bg-surface-elevated transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="font-display text-xl font-bold text-white">Your Portfolio</h1>
      </div>

      {/* Lifetime overview */}
      <div className="grid grid-cols-3 gap-2.5 mb-4">
        <StatCard label="Lifetime Saved" value={fc(summary.lifetimeSaved)} icon="💰" />
        <StatCard label="Current Savings" value={fc(summary.currentSavings)} icon="🏦" />
        <StatCard label="Level" value={`${summary.level}`} icon="⭐" />
      </div>
      <div className="grid grid-cols-3 gap-2.5 mb-4">
        <StatCard label="Goals Done" value={String(summary.completedGoalsCount)} icon="🎯" />
        <StatCard label="In Progress" value={String(summary.activeGoalsCount)} icon="🚧" />
        <StatCard label="Achievements" value={String(summary.achievementsCount)} icon="🏅" />
      </div>
      <div className="grid grid-cols-2 gap-2.5 mb-4">
        <StatCard label="Current Streak" value={`${summary.currentStreak}d`} icon="🔥" />
        <StatCard label="Longest Streak" value={`${summary.longestStreak}d`} icon="👑" />
      </div>

      {/* Financial Health */}
      <div className="card p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-white/40 text-xs uppercase tracking-wide">Financial Health</p>
          <span className={`text-sm font-semibold ${HEALTH_COLOR[summary.healthScore.status]}`}>
            {summary.healthScore.status} · {summary.healthScore.score}/100
          </span>
        </div>
        <div className="space-y-1.5">
          {summary.healthScore.factors.map((f) => (
            <div key={f.name} className="flex justify-between text-xs">
              <span className="text-white/50">{f.name}</span>
              <span className="text-white/70">{f.points}/{f.maxPoints}</span>
            </div>
          ))}
        </div>
        {summary.healthScore.recommendations.length > 0 && (
          <ul className="mt-3 pt-3 border-t border-surface-border space-y-1">
            {summary.healthScore.recommendations.map((r, i) => (
              <li key={i} className="text-xs text-white/50">{r}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Sprint 28.5 — Phase 5/6: Quarter cash flow projection.
          Portfolio-wide (all goals combined), not per-goal — the one
          genuinely new number this page didn't already show. Renders
          nothing when there isn't enough deposit history, same
          "no fabricated placeholder" convention as every other card here. */}
      {cashFlow && cashFlow.projectedBalanceQuarter !== null && (
        <div className="card p-4 mb-4" aria-labelledby="cashflow-heading">
          <p id="cashflow-heading" className="text-white/40 text-xs uppercase tracking-wide mb-2">
            Quarter Projection
          </p>
          <p className="font-display text-2xl font-bold text-white">{fc(cashFlow.projectedBalanceQuarter)}</p>
          <p className="text-white/50 text-xs mt-1">
            projected in 90 days, at your current pace of {fc(cashFlow.weeklyPace ?? 0)}/week
          </p>
          <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-surface-border text-xs">
            <div>
              <span className="text-white/40">30 days</span>
              <p className="text-white/80 font-medium">{fc(cashFlow.projectedBalance30Day ?? 0)}</p>
            </div>
            <div>
              <span className="text-white/40">60 days</span>
              <p className="text-white/80 font-medium">{fc(cashFlow.projectedBalance60Day ?? 0)}</p>
            </div>
          </div>
          {cashFlow.fundableWithinQuarter.length > 0 && (
            <p className="text-xs text-emerald-400/90 mt-3 pt-3 border-t border-surface-border">
              At this pace, {cashFlow.fundableWithinQuarter.length === 1 ? "1 goal" : `${cashFlow.fundableWithinQuarter.length} goals`} could
              individually be funded within the quarter if you focused your saving there.
            </p>
          )}
        </div>
      )}

      {/* Sprint 28.5 — Phase 3/5: Recommended goal. First real UI consumer
          of lib/recommendations.ts (Phase 1 audit found zero call sites
          before this). Every field shown ("why", suggested target/pace,
          difficulty) already exists on GoalRecommendation — no new
          calculation, this is purely presentation. */}
      {topRecommendation && (
        <div className="card p-4 mb-4" aria-labelledby="recommendation-heading">
          <div className="flex items-center gap-1.5 mb-2">
            <Sparkles size={14} className="text-amber-400" />
            <p id="recommendation-heading" className="text-white/40 text-xs uppercase tracking-wide">Suggested Next Goal</p>
          </div>
          <p className="font-display text-lg font-bold text-white">{topRecommendation.title}</p>
          <p className="text-white/60 text-sm mt-1 leading-snug">{topRecommendation.reason}</p>
          <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-surface-border text-xs">
            <div>
              <span className="text-white/40">Suggested target</span>
              <p className="text-white/80 font-medium">{fc(topRecommendation.suggestedTarget)}</p>
            </div>
            <div>
              <span className="text-white/40">Per week</span>
              <p className="text-white/80 font-medium">{fc(topRecommendation.suggestedWeeklySaving)}</p>
            </div>
          </div>
          <div className="flex items-center justify-between mt-3">
            <span className="text-[11px] text-white/40">{DIFFICULTY_LABEL[topRecommendation.difficulty]}</span>
            <Link href="/goals/new" className="text-xs font-medium text-brand-400 hover:text-brand-300">
              Start this goal →
            </Link>
          </div>
        </div>
      )}

      {/* Financial Personality */}
      <div className="card p-4 mb-4">
        <p className="text-white/40 text-xs uppercase tracking-wide mb-2">Financial Personality</p>
        <p className="font-display text-lg font-bold text-white">{summary.financialPersonality.personality}</p>
        <p className="text-white/60 text-sm mt-1 leading-snug">{summary.financialPersonality.explanation}</p>
        <p className="text-white/30 text-[11px] mt-2">Confidence: {Math.round(summary.financialPersonality.confidence * 100)}%</p>
      </div>

      {/* Monthly performance */}
      <div className="card p-4 mb-4">
        <p className="text-white/40 text-xs uppercase tracking-wide mb-2">This Month</p>
        <p className="font-display text-2xl font-bold text-white">{fc(summary.monthlyPerformance.monthlySavings)}</p>
        {summary.monthlyPerformance.savingsChangeFromPreviousMonth.percent !== null && (
          <p className={`text-xs mt-1 ${summary.monthlyPerformance.savingsChangeFromPreviousMonth.percent >= 0 ? "text-emerald-400" : "text-white/40"}`}>
            {summary.monthlyPerformance.savingsChangeFromPreviousMonth.percent >= 0 ? "▲" : "▼"} {Math.abs(Math.round(summary.monthlyPerformance.savingsChangeFromPreviousMonth.percent))}% vs last month
          </p>
        )}
      </div>

      {/* Recent milestones */}
      {summary.recentMilestoneLabels.length > 0 && (
        <div className="card p-4 mb-4">
          <p className="text-white/40 text-xs uppercase tracking-wide mb-2">Recent Milestones</p>
          <ul className="space-y-1.5">
            {summary.recentMilestoneLabels.map((label, i) => (
              <li key={i} className="text-sm text-white/70">🏆 {label}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
