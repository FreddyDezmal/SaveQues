"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { StatCard } from "@/app/(app)/dashboard/DashboardClient";
import type { PortfolioSummary } from "@/lib/portfolioSummary";

import PortfolioIntelligenceCard from "@/components/insights/PortfolioIntelligenceCard";
import type { PortfolioIntelligence } from "@/lib/portfolioIntelligence";

interface Props {
  summary: PortfolioSummary;
  portfolioIntelligence: PortfolioIntelligence;
  currencyCode: string;
  locale: string;
}

const HEALTH_COLOR: Record<string, string> = {
  Excellent: "text-emerald-400",
  Good: "text-blue-400",
  "Needs Attention": "text-amber-400",
  "At Risk": "text-red-400",
};

export default function PortfolioClient({ summary, portfolioIntelligence, currencyCode, locale }: Props) {
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
        <div className="space-y-2">
          {summary.healthScore.factors.map((f) => (
            <div key={f.name}>
              <div className="flex justify-between text-xs">
                <span className="text-white/50">{f.name}</span>
                <span className="text-white/70">{f.points}/{f.maxPoints}</span>
              </div>
              {/* Sprint 28.5 — Phase 5/7: same fix as GoalIntelligenceCard —
                  accountHealth.ts has always computed this explanation,
                  it just wasn't rendered here either. */}
              <p className="text-[11px] text-white/55 mt-0.5">{f.explanation}</p>
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

      {/* Sprint 28.5 — Phase 5: Portfolio Intelligence */}
      <PortfolioIntelligenceCard data={portfolioIntelligence} formatAmount={fc} />

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
