/**
 * tests/component/FinancialHealthCard.test.tsx
 * Sprint 28 — Phase 5/11/15.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import FinancialHealthCard from "@/components/insights/FinancialHealthCard";
import type { FinancialHealthScore } from "@/lib/financialHealthScore";
import type { CashFlowProjection } from "@/lib/cashFlowProjection";

const formatAmount = (n: number) => `R${n.toFixed(2)}`;

function score(overrides: Partial<FinancialHealthScore> = {}): FinancialHealthScore {
  return {
    score: 72,
    tier: "Healthy",
    factors: [
      { name: "Consistency", points: 10, maxPoints: 15, explanation: "" },
      { name: "Emergency readiness", points: 0, maxPoints: 10, explanation: "No emergency fund goal set up yet." },
      { name: "Goal diversification", points: 5, maxPoints: 10, explanation: "" },
    ],
    recommendations: ["Consider starting an emergency fund goal."],
    trend: "improving",
    ...overrides,
  };
}

function cashFlow(overrides: Partial<CashFlowProjection> = {}): CashFlowProjection {
  return {
    currentBalance: 1000,
    weeklyPace: 100,
    projectedAdditionalSavings30Day: 400,
    projectedAdditionalSavings60Day: 800,
    projectedAdditionalSavingsQuarter: 1200,
    projectedBalance30Day: 1400,
    projectedBalance60Day: 1800,
    projectedBalanceQuarter: 2200,
    fundableWithinQuarter: [],
    insufficientDataReason: null,
    ...overrides,
  };
}

describe("FinancialHealthCard", () => {
  it("renders nothing when healthScore is null", () => {
    const { container } = render(<FinancialHealthCard healthScore={null} cashFlow={null} formatAmount={formatAmount} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the score, tier, and top recommendation", () => {
    render(<FinancialHealthCard healthScore={score()} cashFlow={null} formatAmount={formatAmount} />);
    expect(screen.getByText("72/100")).toBeInTheDocument();
    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.getByText("Consider starting an emergency fund goal.")).toBeInTheDocument();
  });

  it("surfaces the two factors with the most room to improve, not the strongest ones", () => {
    render(<FinancialHealthCard healthScore={score()} cashFlow={null} formatAmount={formatAmount} />);
    // Emergency readiness is 0/10 (0%) and Goal diversification is 5/10 (50%) —
    // both weaker, proportionally, than Consistency at 10/15 (67%).
    expect(screen.getByText("Emergency readiness")).toBeInTheDocument();
    expect(screen.getByText("Goal diversification")).toBeInTheDocument();
    expect(screen.queryByText("Consistency")).not.toBeInTheDocument();
  });

  it("renders the quarter cash flow projection when provided", () => {
    render(<FinancialHealthCard healthScore={score()} cashFlow={cashFlow()} formatAmount={formatAmount} />);
    expect(screen.getByText("R1200.00")).toBeInTheDocument();
  });

  it("omits the cash flow line when there isn't enough data", () => {
    render(
      <FinancialHealthCard
        healthScore={score()}
        cashFlow={cashFlow({ projectedAdditionalSavingsQuarter: null })}
        formatAmount={formatAmount}
      />
    );
    expect(screen.queryByText(/next 90 days/)).not.toBeInTheDocument();
  });

  it("gives the health score bar an accessible text-equivalent label, not colour alone", () => {
    render(<FinancialHealthCard healthScore={score()} cashFlow={null} formatAmount={formatAmount} />);
    expect(screen.getByRole("img", { name: /financial health score: 72 out of 100, rated healthy/i })).toBeInTheDocument();
  });
});
