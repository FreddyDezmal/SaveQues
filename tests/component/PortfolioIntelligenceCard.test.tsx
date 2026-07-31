/**
 * tests/component/PortfolioIntelligenceCard.test.tsx
 * Sprint 28.5 — Phase 5/11.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PortfolioIntelligenceCard from "@/components/insights/PortfolioIntelligenceCard";
import type { PortfolioIntelligence } from "@/lib/portfolioIntelligence";

const formatAmount = (n: number) => `R${n.toFixed(2)}`;

function data(overrides: Partial<PortfolioIntelligence> = {}): PortfolioIntelligence {
  return {
    strongestGoal: { goalId: "strong", title: "Emergency Fund", score: 88, status: "Excellent", explanation: "Consistent weekly deposits." },
    weakestGoal: { goalId: "weak", title: "New Car", score: 40, status: "Needs Attention", explanation: "No deposit in 30 days." },
    diversification: { activeCategoryCount: 2, totalCategoryCount: 5, explanation: "Active goals span 2 of 5 categories." },
    quarterProjection: { projectedBalance: 5000, projectedAdditionalSavings: 1200, explanation: "At your recent pace..." },
    completionForecast: { goalId: "later", title: "New Car", projectedCompletionDate: "2026-09-01" },
    opportunity: { goalId: "gift", title: "Birthday Gift", reason: "Projected to finish 2026-04-01 — the soonest of your active goals at current pace." },
    ...overrides,
  };
}

describe("PortfolioIntelligenceCard", () => {
  it("renders nothing when there is no content at all", () => {
    const { container } = render(
      <PortfolioIntelligenceCard
        data={{
          strongestGoal: null,
          weakestGoal: null,
          diversification: { activeCategoryCount: 0, totalCategoryCount: 0, explanation: "No active goals yet to measure spread across categories." },
          quarterProjection: { projectedBalance: null, projectedAdditionalSavings: null, explanation: "No deposits yet." },
          completionForecast: null,
          opportunity: null,
        }}
        formatAmount={formatAmount}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows strongest and weakest goal with the weakest goal's explanation, not just its score", () => {
    render(<PortfolioIntelligenceCard data={data()} formatAmount={formatAmount} />);
    expect(screen.getByText("Emergency Fund")).toBeInTheDocument();
    expect(screen.getByText("New Car")).toBeInTheDocument();
    expect(screen.getByText(/no deposit in 30 days/i)).toBeInTheDocument();
  });

  it("does not show a weakest-goal block when strongest and weakest are the same goal", () => {
    const single = data({ weakestGoal: { goalId: "strong", title: "Emergency Fund", score: 88, status: "Excellent", explanation: "x" } });
    render(<PortfolioIntelligenceCard data={single} formatAmount={formatAmount} />);
    expect(screen.queryByText(/needs attention/i)).not.toBeInTheDocument();
  });

  it("shows the quarter projection amount", () => {
    render(<PortfolioIntelligenceCard data={data()} formatAmount={formatAmount} />);
    expect(screen.getByText("R5000.00")).toBeInTheDocument();
  });

  it("shows the opportunity with its reason and a link to that goal", () => {
    render(<PortfolioIntelligenceCard data={data()} formatAmount={formatAmount} />);
    expect(screen.getByText(/soonest of your active goals/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view goal/i })).toHaveAttribute("href", "/goals/gift");
  });

  it("shows the diversification explanation always, even with no strongest/weakest goal", () => {
    render(
      <PortfolioIntelligenceCard
        data={data({ strongestGoal: null, weakestGoal: null })}
        formatAmount={formatAmount}
      />
    );
    expect(screen.getByText(/active goals span 2 of 5 categories/i)).toBeInTheDocument();
  });

  it("exposes itself as a named landmark section for screen-reader heading navigation — Sprint 28.5 Phase 10 fix", () => {
    render(<PortfolioIntelligenceCard data={data()} formatAmount={formatAmount} />);
    expect(screen.getByRole("heading", { name: /portfolio intelligence/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /portfolio intelligence/i })).toBeInTheDocument();
  });
});
