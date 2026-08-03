/**
 * tests/component/IntelligenceClient.test.tsx
 * Sprint 30 — Phase 4/13: Intelligence Center.
 *
 * Builds a real FinancialIntelligence bundle via getFinancialIntelligence()
 * (same fixture pattern as tests/unit/getFinancialIntelligence.test.ts)
 * rather than hand-faking every one of its ~13 fields — this test is
 * about IntelligenceClient's composition/gating, not re-verifying each
 * engine's own math (that's each engine's own unit test's job).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import IntelligenceClient from "@/app/(app)/intelligence/IntelligenceClient";
import { getFinancialIntelligence } from "@/lib/intelligence/getFinancialIntelligence";
import { forecastGoal } from "@/lib/forecast";
import { computeGoalHealth } from "@/lib/goalHealth";
import { coachingMessagesForGoal } from "@/lib/coaching";
import type { SavingsGoal, Transaction } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

// IntelligenceClient renders PremiumForecastCard (Sprint 30 Phase 2), which
// reads billing status via this hook — mocked as "not premium" here since
// this test is about IntelligenceClient's section composition, not
// re-testing PremiumForecastCard's own locked/unlocked states (that's
// PremiumForecastCard.test.tsx's job).
vi.mock("@/lib/hooks/useBillingStatus", () => ({
  useBillingStatus: () => ({ status: null, loading: false, isPremium: false }),
}));

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    user_id: "u1",
    goal_id: "g1",
    amount: 100,
    note: null,
    transaction_type: "deposit",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function goal(overrides: Partial<SavingsGoal> = {}): SavingsGoal {
  return {
    id: "g1",
    user_id: "u1",
    title: "Trip to Cape Town",
    category: "vacation",
    goal_emoji: "✈️",
    target_amount: 1000,
    current_amount: 200,
    target_date: null,
    is_complete: false,
    is_primary: true,
    is_active: true,
    goal_status: "active",
    completed_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const now = new Date("2026-03-01T00:00:00Z");
const weeklyDeposits = [
  tx({ created_at: "2026-02-01T00:00:00Z", amount: 100 }),
  tx({ created_at: "2026-02-08T00:00:00Z", amount: 100 }),
  tx({ created_at: "2026-02-15T00:00:00Z", amount: 100 }),
  tx({ created_at: "2026-02-22T00:00:00Z", amount: 100 }),
];

const g = goal();
const intelligence = getFinancialIntelligence({
  transactions: weeklyDeposits,
  goals: [g],
  activityLog: [{ date: "2026-02-28", xp_earned: 10, actions_count: 1 }],
  achievements: [],
  profile: { streak_days: 3, longest_streak: 5, currency_code: "ZAR", locale: "en-ZA" },
  now,
});

const priorityGoalIntelligence = {
  forecast: forecastGoal(g, weeklyDeposits, now),
  health: computeGoalHealth(g, weeklyDeposits, now),
  coaching: coachingMessagesForGoal(g, weeklyDeposits),
};

describe("IntelligenceClient", () => {
  it("shows the not-enough-history empty state when intelligence is null, not a broken page", () => {
    render(
      <IntelligenceClient
        intelligence={null}
        priorityGoal={null}
        priorityGoalIntelligence={null}
        goals={[]}
        currencyCode="ZAR"
        locale="en-ZA"
      />
    );
    expect(screen.getByText(/not enough history yet/i)).toBeInTheDocument();
  });

  it("renders every documented Phase 4 section when there's enough history", () => {
    render(
      <IntelligenceClient
        intelligence={intelligence}
        priorityGoal={g}
        priorityGoalIntelligence={priorityGoalIntelligence}
        goals={[{ id: "g1", title: "Trip to Cape Town" }]}
        currencyCode="ZAR"
        locale="en-ZA"
      />
    );
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(
      expect.arrayContaining([
        "Overview",
        "Financial Health",
        "Forecast",
        "Top Priority Goal",
        "Behavior & Risk",
        "Category Intelligence",
        "Recommendations",
      ])
    );
  });

  it("links the priority goal to its real goal detail page, not a synthetic route", () => {
    render(
      <IntelligenceClient
        intelligence={intelligence}
        priorityGoal={g}
        priorityGoalIntelligence={priorityGoalIntelligence}
        goals={[{ id: "g1", title: "Trip to Cape Town" }]}
        currencyCode="ZAR"
        locale="en-ZA"
      />
    );
    const link = screen.getByRole("link", { name: /trip to cape town/i });
    expect(link).toHaveAttribute("href", "/goals/g1");
  });

  it("omits the Top Priority Goal section entirely when there is no active goal, rather than showing an empty card", () => {
    render(
      <IntelligenceClient
        intelligence={intelligence}
        priorityGoal={null}
        priorityGoalIntelligence={null}
        goals={[]}
        currencyCode="ZAR"
        locale="en-ZA"
      />
    );
    expect(screen.queryByText("Top Priority Goal")).not.toBeInTheDocument();
  });
});
