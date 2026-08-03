"use client";

/**
 * components/insights/PremiumForecastCard.tsx
 * ─────────────────────────────────────────────────────────────
 * Sprint 30 — Phase 2: Premium Dashboard Experience.
 *
 * Does NOT recompute anything. lib/cashFlowProjection.ts (Sprint 28) has
 * always calculated 30/60/90-day projections — FinancialHealthCard just
 * only ever surfaced the 90-day number, to every user, ungated. This card
 * is purely a display extension: the full 3-window breakdown, gated
 * behind the `advanced_forecasting` feature that Sprint 29's migration
 * 069 already seeded onto the premium plan and that nothing has read
 * from until now (see Sprint 30 Phase 1 audit).
 *
 * Reuses the exact gating pattern every other premium surface in this
 * codebase already follows: useBillingStatus() client hook (Sprint 29),
 * LockedCard for the free-tier preview (Sprint 29, previously unused
 * anywhere in the app — see audit), PremiumBadge for the unlocked state.
 * No new entitlement-checking logic — same one hook, same one component.
 *
 * Free users still see the plain 90-day line on FinancialHealthCard
 * (unchanged, ungated — it always has been, and Sprint 30's brief says
 * "never remove/hide functionality without explaining it", so that
 * existing free number stays exactly as-is). This card adds the fuller
 * breakdown on top, not a replacement.
 */

import { useRouter } from "next/navigation";
import type { CashFlowProjection } from "@/lib/cashFlowProjection";
import { useFeatureEntitlement } from "@/lib/hooks/useFeatureEntitlement";
import LockedCard from "@/components/billing/LockedCard";
import PremiumBadge from "@/components/billing/PremiumBadge";

interface Props {
  cashFlow: CashFlowProjection | null;
  formatAmount: (n: number) => string;
}

function ForecastRow({ label, days, balance, additional, formatAmount }: {
  label: string;
  days: number;
  balance: number | null;
  additional: number | null;
  formatAmount: (n: number) => string;
}) {
  if (balance === null || additional === null) return null;
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
      <div>
        <p className="text-sm text-white/80">{label}</p>
        <p className="text-[11px] text-white/45">{days}-day projection</p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold text-white">{formatAmount(balance)}</p>
        <p className="text-[11px] text-emerald-400">+{formatAmount(additional)}</p>
      </div>
    </div>
  );
}

export default function PremiumForecastCard({ cashFlow, formatAmount }: Props) {
  const router = useRouter();
  const { entitled } = useFeatureEntitlement("advanced_forecasting");

  // Same null-render convention as FinancialHealthCard — don't show a
  // forecast card (locked or unlocked) when there isn't enough deposit
  // history to project from.
  if (!cashFlow || cashFlow.insufficientDataReason) return null;
  if (cashFlow.weeklyPace === null) return null;

  const body = (
    <>
      <div className="flex items-center justify-between mb-1">
        <h2 id="premium-forecast-heading" className="text-sm font-semibold text-white/90">Premium Forecast</h2>
        {entitled && <PremiumBadge variant="icon" />}
      </div>
      <p className="text-[11px] text-white/45 mb-3">
        Based on your recent deposit pace ({formatAmount(cashFlow.weeklyPace)}/week average).
      </p>
      <ForecastRow
        label="30 days"
        days={30}
        balance={cashFlow.projectedBalance30Day}
        additional={cashFlow.projectedAdditionalSavings30Day}
        formatAmount={formatAmount}
      />
      <ForecastRow
        label="60 days"
        days={60}
        balance={cashFlow.projectedBalance60Day}
        additional={cashFlow.projectedAdditionalSavings60Day}
        formatAmount={formatAmount}
      />
      <ForecastRow
        label="90 days"
        days={90}
        balance={cashFlow.projectedBalanceQuarter}
        additional={cashFlow.projectedAdditionalSavingsQuarter}
        formatAmount={formatAmount}
      />
    </>
  );

  if (entitled) {
    return (
      <section className="card p-4 mb-4" aria-labelledby="premium-forecast-heading">
        {body}
      </section>
    );
  }

  return (
    <LockedCard
      title="Premium Forecast"
      description="See your 30, 60, and 90-day savings projection broken out, not just the headline number."
      onUpgradeClick={() => router.push("/settings/billing")}
      className="mb-4"
    >
      {body}
    </LockedCard>
  );
}
