/**
 * tests/component/ScenarioSimulatorCard.test.tsx
 * Sprint 28 — Phase 8/15.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ScenarioSimulatorCard from "@/components/goals/ScenarioSimulatorCard";
import type { SavingsGoal, Transaction } from "@/lib/types";

const formatAmount = (n: number) => `R${n.toFixed(2)}`;

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

function goal(overrides: Partial<SavingsGoal> = {}): Pick<SavingsGoal, "id" | "target_amount" | "current_amount" | "target_date" | "is_complete"> {
  return {
    id: "g1",
    target_amount: 1000,
    current_amount: 200,
    target_date: null,
    is_complete: false,
    ...overrides,
  };
}

const weeklyDeposits = [
  tx({ created_at: "2026-02-01T00:00:00Z", amount: 100 }),
  tx({ created_at: "2026-02-08T00:00:00Z", amount: 100 }),
  tx({ created_at: "2026-02-15T00:00:00Z", amount: 100 }),
  tx({ created_at: "2026-02-22T00:00:00Z", amount: 100 }),
];

describe("ScenarioSimulatorCard", () => {
  it("renders nothing for an already-complete goal", () => {
    const { container } = render(
      <ScenarioSimulatorCard goal={goal({ is_complete: true })} transactions={[]} formatAmount={formatAmount} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("starts collapsed, showing the reassurance line and not the scenario list", () => {
    render(<ScenarioSimulatorCard goal={goal()} transactions={weeklyDeposits} formatAmount={formatAmount} />);
    expect(screen.getByText(/nothing here changes your real goal/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Scenario amount")).not.toBeInTheDocument();
  });

  it("expands to show standard scenarios and the custom scenario form", async () => {
    const user = userEvent.setup();
    render(<ScenarioSimulatorCard goal={goal()} transactions={weeklyDeposits} formatAmount={formatAmount} />);

    await user.click(screen.getByRole("button", { name: /what if/i }));

    expect(screen.getByText(/skip the next deposit/i)).toBeInTheDocument();
    expect(screen.getByText(/switch to biweekly deposits/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Scenario amount")).toBeInTheDocument();
  });

  it("computes and shows a custom scenario result as the user types an amount", async () => {
    const user = userEvent.setup();
    render(<ScenarioSimulatorCard goal={goal()} transactions={weeklyDeposits} formatAmount={formatAmount} />);

    await user.click(screen.getByRole("button", { name: /what if/i }));
    await user.type(screen.getByLabelText("Scenario amount"), "50");

    expect(screen.getByText(/deposit \$50\/week more/i)).toBeInTheDocument();
  });

  it("never mutates the goal or transactions passed in while interacting", async () => {
    const user = userEvent.setup();
    const g = goal();
    const gSnapshot = JSON.parse(JSON.stringify(g));
    const txsSnapshot = JSON.parse(JSON.stringify(weeklyDeposits));

    render(<ScenarioSimulatorCard goal={g} transactions={weeklyDeposits} formatAmount={formatAmount} />);
    await user.click(screen.getByRole("button", { name: /what if/i }));
    await user.type(screen.getByLabelText("Scenario amount"), "50");

    expect(g).toEqual(gSnapshot);
    expect(weeklyDeposits).toEqual(txsSnapshot);
  });
});
