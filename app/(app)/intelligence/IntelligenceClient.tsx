"use client";

/**
 * app/(app)/intelligence/IntelligenceClient.tsx
 * ─────────────────────────────────────────────────────────────
 * Sprint 30 — Phase 4: Intelligence Center.
 *
 * Every card below already existed before this sprint (see the Phase 1
 * audit) and already renders correctly on the dashboard/goal-detail
 * pages it was built for. This page reuses them as-is — same props, same
 * components — rather than building parallel "full page" versions, per
 * the sprint's "composition over replacement" principle. The only new
 * pieces on this page are the layout/section headers around them and the
 * "Top Priority Goal" section (see page.tsx's comment on why that one
 * has no existing engine behind it yet).
 */

import Link from "next/link";
import { formatCurrency } from "@/lib/utils";
import { getCategoryById } from "@/lib/utils";
import EmptyState from "@/components/ui/EmptyState";
import IntelligencePanel from "@/components/insights/IntelligencePanel";
import PremiumCoachingCard from "@/components/insights/PremiumCoachingCard";
import FinancialHealthCard from "@/components/insights/FinancialHealthCard";
import PremiumForecastCard from "@/components/insights/PremiumForecastCard";
import CategoryIntelligenceCard from "@/components/insights/CategoryIntelligenceCard";
import RecommendedGoalCard from "@/components/insights/RecommendedGoalCard";
import BehaviorInsights from "@/components/behavior/BehaviorInsights";
import GoalIntelligenceCard from "@/components/goals/GoalIntelligenceCard";
import type { FinancialIntelligence } from "@/lib/intelligence/getFinancialIntelligence";
import type { GoalForecast } from "@/lib/forecast";
import type { GoalHealth } from "@/lib/goalHealth";
import type { CoachingMessage } from "@/lib/coaching";
import type { SavingsGoal } from "@/lib/types";

interface Props {
  intelligence: FinancialIntelligence | null;
  priorityGoal: SavingsGoal | null;
  priorityGoalIntelligence: { forecast: GoalForecast; health: GoalHealth; coaching: CoachingMessage[] } | null;
  goals: Pick<SavingsGoal, "id" | "title">[];
  currencyCode: string;
  locale: string;
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold uppercase tracking-wide text-white/35 mb-2 mt-6 first:mt-0">{children}</h2>;
}

export default function IntelligenceClient({ intelligence, priorityGoal, priorityGoalIntelligence, goals, currencyCode, locale }: Props) {
  const formatAmount = (n: number) => formatCurrency(n, currencyCode, locale);

  if (!intelligence) {
    return (
      <div className="p-4 pb-24 max-w-lg mx-auto">
        <h1 className="font-display text-xl font-bold text-white mb-4">Intelligence Center</h1>
        <EmptyState
          emoji="🧠"
          title="Not enough history yet"
          description="Make a few deposits and your Intelligence Center will fill in with your financial health, forecast, and personalized insights."
          action={{ label: "Go to your goals", href: "/goals" }}
        />
      </div>
    );
  }

  const categoryLabel = priorityGoal ? getCategoryById(priorityGoal.category)?.label ?? priorityGoal.category : null;

  return (
    <div className="p-4 pb-24 max-w-lg mx-auto">
      <div className="mb-1">
        <h1 className="font-display text-xl font-bold text-white">Intelligence Center</h1>
        <p className="text-xs text-white/45 mt-0.5">Everything SaveQuest knows about your savings, in one place.</p>
      </div>

      <SectionHeading>Overview</SectionHeading>
      <IntelligencePanel
        insights={intelligence.insights}
        weeklyReview={intelligence.weeklyReview}
        topCoachingMessage={intelligence.topCoachingMessage}
        formatAmount={formatAmount}
      />

      {/* Sprint 30 — Phase 7: unlocks coachingMessages[1:] — IntelligencePanel above already shows coachingMessages[0] (topCoachingMessage) for free, unchanged. */}
      <PremiumCoachingCard
        messages={intelligence.coachingMessages}
        alreadyFreeCount={1}
        goalTitles={Object.fromEntries(goals.map((g) => [g.id, g.title]))}
        trendExplanation={intelligence.behaviorProfile.explanation}
      />

      <SectionHeading>Financial Health</SectionHeading>
      <FinancialHealthCard healthScore={intelligence.financialHealth} cashFlow={intelligence.cashFlow} formatAmount={formatAmount} />

      <SectionHeading>Forecast</SectionHeading>
      <PremiumForecastCard cashFlow={intelligence.cashFlow} formatAmount={formatAmount} />

      {priorityGoal && priorityGoalIntelligence && (
        <>
          <SectionHeading>Top Priority Goal</SectionHeading>
          <Link
            href={`/goals/${priorityGoal.id}`}
            className="flex items-center justify-between card p-3 mb-2 text-sm hover:bg-white/[0.03] transition-colors"
          >
            <span className="text-white/85 font-medium">
              {priorityGoal.title}
              {categoryLabel && <span className="text-white/40 font-normal"> · {categoryLabel}</span>}
            </span>
            <span aria-hidden className="text-white/30">→</span>
          </Link>
          <GoalIntelligenceCard
            forecast={priorityGoalIntelligence.forecast}
            health={priorityGoalIntelligence.health}
            coaching={priorityGoalIntelligence.coaching}
            formatAmount={formatAmount}
          />
        </>
      )}

      <SectionHeading>Behavior & Risk</SectionHeading>
      <BehaviorInsights
        habits={intelligence.habitProfile}
        behaviorProfile={intelligence.behaviorProfile}
        risk={intelligence.behavioralRisk}
        interventions={intelligence.interventions}
      />

      <SectionHeading>Category Intelligence</SectionHeading>
      <CategoryIntelligenceCard data={intelligence.categoryIntelligence} formatAmount={formatAmount} />

      <SectionHeading>Recommendations</SectionHeading>
      <RecommendedGoalCard recommendations={intelligence.goalRecommendations} formatAmount={formatAmount} />
    </div>
  );
}
