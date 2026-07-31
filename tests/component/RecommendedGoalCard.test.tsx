/**
 * tests/component/RecommendedGoalCard.test.tsx
 * Sprint 28.5 — Phase 3/11.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RecommendedGoalCard from "@/components/insights/RecommendedGoalCard";
import type { GoalRecommendation } from "@/lib/recommendations";

const formatAmount = (n: number) => `R${n.toFixed(2)}`;

function recommendation(overrides: Partial<GoalRecommendation> = {}): GoalRecommendation {
  return {
    category: "travel",
    title: "Vacation",
    reason: "A dedicated travel fund keeps a trip from becoming a last-minute scramble.",
    suggestedTarget: 8000,
    suggestedDurationWeeks: 16,
    suggestedWeeklySaving: 500,
    estimatedCompletionDate: "2026-06-01",
    difficulty: "moderate",
    ...overrides,
  };
}

describe("RecommendedGoalCard", () => {
  it("renders nothing when there are no recommendations", () => {
    const { container } = render(<RecommendedGoalCard recommendations={[]} formatAmount={formatAmount} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders only the top recommendation, not the full list", () => {
    render(
      <RecommendedGoalCard
        recommendations={[recommendation({ title: "Vacation" }), recommendation({ title: "Emergency Fund", category: "emergency" })]}
        formatAmount={formatAmount}
      />
    );
    expect(screen.getByText("Vacation")).toBeInTheDocument();
    expect(screen.queryByText("Emergency Fund")).not.toBeInTheDocument();
  });

  it("shows the reason, suggested target, and suggested weekly amount", () => {
    render(<RecommendedGoalCard recommendations={[recommendation()]} formatAmount={formatAmount} />);
    expect(screen.getByText(/last-minute scramble/i)).toBeInTheDocument();
    expect(screen.getByText("R8000.00")).toBeInTheDocument();
    expect(screen.getByText("R500.00/week")).toBeInTheDocument();
  });

  it("labels difficulty in plain language, not just the raw enum value", () => {
    render(<RecommendedGoalCard recommendations={[recommendation({ difficulty: "easy" })]} formatAmount={formatAmount} />);
    expect(screen.getByText(/easy fit for your pace/i)).toBeInTheDocument();
    expect(screen.queryByText(/^easy$/i)).not.toBeInTheDocument();
  });

  it("links the CTA to the goal creation flow", () => {
    render(<RecommendedGoalCard recommendations={[recommendation()]} formatAmount={formatAmount} />);
    expect(screen.getByRole("link", { name: /start this goal/i })).toHaveAttribute("href", "/goals/new");
  });
});
