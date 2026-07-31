/**
 * tests/component/GoalIntelligenceCard.test.tsx
 * Sprint 28.5 — Phase 4/7/11.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GoalIntelligenceCard from "@/components/goals/GoalIntelligenceCard";
import type { GoalForecast } from "@/lib/forecast";
import type { GoalHealth } from "@/lib/goalHealth";
import type { CoachingMessage } from "@/lib/coaching";

const formatAmount = (n: number) => `R${n.toFixed(2)}`;

function forecast(overrides: Partial<GoalForecast> = {}): GoalForecast {
  return {
    goalId: "g1",
    remaining: 800,
    currentWeeklyPace: 100,
    requiredWeeklyPace: 120,
    requiredMonthlyPace: 480,
    paceStatus: "behind",
    projectedCompletionDate: "2026-06-01",
    estimatedDaysRemaining: 90,
    estimatedWeeksRemaining: 13,
    isComplete: false,
    insufficientDataReason: null,
    ...overrides,
  };
}

function health(overrides: Partial<GoalHealth> = {}): GoalHealth {
  return {
    goalId: "g1",
    score: 62,
    status: "Needs Attention",
    factors: [
      { name: "Recent activity", points: 15, maxPoints: 30, explanation: "Last deposit was 20 days ago — getting stale." },
      { name: "Deposit frequency", points: 10, maxPoints: 20, explanation: "Averaging 0.5 deposit(s)/week." },
      { name: "Progress velocity", points: 15, maxPoints: 25, explanation: "Current pace is 83% of the pace needed to hit the target date." },
      { name: "Consistency", points: 10, maxPoints: 15, explanation: "Consistency score: 66/100." },
      { name: "Deadline pressure", points: 8, maxPoints: 10, explanation: "Target date is 90 days away — comfortable runway." },
    ],
    ...overrides,
  };
}

const coaching: CoachingMessage[] = [
  { id: "c1", message: "You're a bit behind pace on this goal.", priority: 1 } as CoachingMessage,
];

describe("GoalIntelligenceCard", () => {
  it("renders nothing for a completed goal's forecast", () => {
    const { container } = render(
      <GoalIntelligenceCard forecast={forecast({ isComplete: true })} health={health()} coaching={[]} formatAmount={formatAmount} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("does not show factor explanations before expanding", () => {
    render(<GoalIntelligenceCard forecast={forecast()} health={health()} coaching={coaching} formatAmount={formatAmount} />);
    expect(screen.queryByText(/getting stale/i)).not.toBeInTheDocument();
  });

  it("shows every factor's explanation text once expanded — the Phase 4/7 fix", async () => {
    const user = userEvent.setup();
    render(<GoalIntelligenceCard forecast={forecast()} health={health()} coaching={coaching} formatAmount={formatAmount} />);

    await user.click(screen.getByRole("button", { expanded: false }));

    for (const f of health().factors) {
      expect(screen.getByText(f.explanation)).toBeInTheDocument();
    }
  });

  it("shows the assumption disclaimer alongside the required pace, not hidden", async () => {
    const user = userEvent.setup();
    render(<GoalIntelligenceCard forecast={forecast()} health={health()} coaching={coaching} formatAmount={formatAmount} />);

    await user.click(screen.getByRole("button", { expanded: false }));

    expect(screen.getByText(/assumes even weekly deposits/i)).toBeInTheDocument();
  });

  it("shows the top coaching message even when collapsed", () => {
    render(<GoalIntelligenceCard forecast={forecast()} health={health()} coaching={coaching} formatAmount={formatAmount} />);
    expect(screen.getByText(/a bit behind pace/i)).toBeInTheDocument();
  });
});
