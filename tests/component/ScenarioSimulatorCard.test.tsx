/**
 * tests/component/ScenarioSimulatorCard.test.tsx
 * Sprint 28 — Phase 8/15.
 * Sprint 30 — Phase 3/13: quota enforcement + saved scenarios.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ScenarioSimulatorCard from "@/components/goals/ScenarioSimulatorCard";
import type { SavingsGoal, Transaction } from "@/lib/types";

const formatAmount = (n: number) => `R${n.toFixed(2)}`;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
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

/**
 * Default fetch mock: scenario-run always allowed, no saved scenarios yet,
 * scenario-saved POST succeeds. Individual tests override this to exercise
 * the blocked-quota and saved-scenario paths.
 */
function mockFetch(overrides: { runBlocked?: boolean; saveBlocked?: boolean; saved?: any[] } = {}) {
  const { runBlocked = false, saveBlocked = false, saved = [] } = overrides;
  return vi.fn((url: string, init?: RequestInit) => {
    if (typeof url === "string" && url.startsWith("/api/goal/scenario-run")) {
      if (runBlocked) {
        return Promise.resolve({
          status: 403,
          ok: false,
          json: async () => ({ error: "You've reached your plan's daily scenario limit (3). Upgrade to Premium for unlimited access.", limit: 3, used: 3 }),
        } as Response);
      }
      return Promise.resolve({ status: 200, ok: true, json: async () => ({ ok: true }) } as Response);
    }
    if (typeof url === "string" && url.startsWith("/api/goal/scenario-saved")) {
      if (init?.method === "POST") {
        if (saveBlocked) {
          return Promise.resolve({
            status: 403,
            ok: false,
            json: async () => ({ error: "You've reached the Free plan's limit of 1 saved scenario per goal. Upgrade to Premium to save more." }),
          } as Response);
        }
        const body = JSON.parse((init.body as string) ?? "{}");
        return Promise.resolve({
          status: 201,
          ok: true,
          json: async () => ({ scenario: { id: "saved-1", ...body, created_at: new Date().toISOString() } }),
        } as Response);
      }
      if (init?.method === "DELETE") {
        return Promise.resolve({ status: 200, ok: true, json: async () => ({ ok: true }) } as Response);
      }
      return Promise.resolve({ status: 200, ok: true, json: async () => ({ scenarios: saved }) } as Response);
    }
    return Promise.resolve({ status: 404, ok: false, json: async () => ({}) } as Response);
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch());
});

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

    await waitFor(() => expect(screen.getByText(/skip the next deposit/i)).toBeInTheDocument());
    expect(screen.getByText(/switch to biweekly deposits/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Scenario amount")).toBeInTheDocument();
  });

  it("requires an explicit Run before showing a custom scenario result (quota is per-action, not per-keystroke)", async () => {
    const user = userEvent.setup();
    render(<ScenarioSimulatorCard goal={goal()} transactions={weeklyDeposits} formatAmount={formatAmount} />);

    await user.click(screen.getByRole("button", { name: /what if/i }));
    await user.type(screen.getByLabelText("Scenario amount"), "50");
    expect(screen.queryByText(/deposit R50\.00\/week more/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^run$/i }));
    await waitFor(() => expect(screen.getByText(/deposit R50\.00\/week more/i)).toBeInTheDocument());
  });

  it("never mutates the goal or transactions passed in while interacting", async () => {
    const user = userEvent.setup();
    const g = goal();
    const gSnapshot = JSON.parse(JSON.stringify(g));
    const txsSnapshot = JSON.parse(JSON.stringify(weeklyDeposits));

    render(<ScenarioSimulatorCard goal={g} transactions={weeklyDeposits} formatAmount={formatAmount} />);
    await user.click(screen.getByRole("button", { name: /what if/i }));
    await user.type(screen.getByLabelText("Scenario amount"), "50");
    await user.click(screen.getByRole("button", { name: /^run$/i }));

    expect(g).toEqual(gSnapshot);
    expect(weeklyDeposits).toEqual(txsSnapshot);
  });
});

describe("ScenarioSimulatorCard — comparison bars (Sprint 28.5 Phase 6)", () => {
  const recentWeeklyDeposits = [0, 1, 2, 3].map((weeksAgo) =>
    tx({ created_at: new Date(Date.now() - weeksAgo * 7 * 86400000).toISOString(), amount: 100 })
  );

  it("renders a decorative, aria-hidden comparison bar for each standard scenario with a delta", async () => {
    const user = userEvent.setup();
    const { container } = render(<ScenarioSimulatorCard goal={goal()} transactions={recentWeeklyDeposits} formatAmount={formatAmount} />);

    await user.click(screen.getByRole("button", { name: /what if/i }));
    await waitFor(() => expect(container.querySelectorAll('li div[aria-hidden="true"]').length).toBeGreaterThan(0));
  });

  it("does not render a bar for a scenario with no projectable delta (insufficient data)", async () => {
    const user = userEvent.setup();
    const { container } = render(<ScenarioSimulatorCard goal={goal()} transactions={[]} formatAmount={formatAmount} />);

    await user.click(screen.getByRole("button", { name: /what if/i }));
    await waitFor(() => expect(screen.getByText(/skip the next deposit/i)).toBeInTheDocument());
    expect(container.querySelectorAll('li div[aria-hidden="true"]').length).toBe(0);
  });
});

describe("ScenarioSimulatorCard — Sprint 30 Phase 3: quota enforcement", () => {
  it("shows an upgrade prompt instead of the scenario list when the daily quota is exhausted", async () => {
    vi.stubGlobal("fetch", mockFetch({ runBlocked: true }));
    const user = userEvent.setup();
    render(<ScenarioSimulatorCard goal={goal()} transactions={weeklyDeposits} formatAmount={formatAmount} />);

    await user.click(screen.getByRole("button", { name: /what if/i }));

    await waitFor(() => expect(screen.getByText(/daily scenario limit/i)).toBeInTheDocument());
    expect(screen.queryByText(/skip the next deposit/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /upgrade/i })).toBeInTheDocument();
    // Sprint 30 — Phase 9: the server-provided limit/used numbers should
    // now surface as a concrete usage detail, not just the prose message.
    expect(screen.getByText(/3 of 3 simulations used today/i)).toBeInTheDocument();
  });

  it("blocks a custom scenario run the same way once the quota is hit mid-session", async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ScenarioSimulatorCard goal={goal()} transactions={weeklyDeposits} formatAmount={formatAmount} />);

    await user.click(screen.getByRole("button", { name: /what if/i }));
    await waitFor(() => expect(screen.getByText(/skip the next deposit/i)).toBeInTheDocument());

    // Simulate the quota running out between the initial expand and the custom run.
    fetchMock.mockImplementation(((url: string) =>
      typeof url === "string" && url.startsWith("/api/goal/scenario-run")
        ? Promise.resolve({ status: 403, ok: false, json: async () => ({ error: "You've reached your plan's daily scenario limit." }) } as Response)
        : Promise.resolve({ status: 200, ok: true, json: async () => ({ scenarios: [] }) } as Response)) as any);

    await user.type(screen.getByLabelText("Scenario amount"), "50");
    await user.click(screen.getByRole("button", { name: /^run$/i }));

    await waitFor(() => expect(screen.getByText(/daily scenario limit/i)).toBeInTheDocument());
    expect(screen.queryByText(/deposit R50\.00\/week more/i)).not.toBeInTheDocument();
  });
});

describe("ScenarioSimulatorCard — Sprint 30 Phase 3: saved scenarios", () => {
  it("loads and lists previously saved scenarios for this goal", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        saved: [
          { id: "s1", goal_id: "g1", scenario_type: "weekly_delta", amount: 30, interval_days: null, label: "Deposit $30/week more", created_at: new Date().toISOString() },
        ],
      })
    );
    const user = userEvent.setup();
    render(<ScenarioSimulatorCard goal={goal()} transactions={weeklyDeposits} formatAmount={formatAmount} />);

    await user.click(screen.getByRole("button", { name: /what if/i }));

    await waitFor(() => expect(screen.getByText("Saved scenarios")).toBeInTheDocument());
    expect(screen.getAllByText("Deposit $30/week more").length).toBeGreaterThan(0);
  });

  it("saving a scenario shows an upgrade prompt when the saved-scenario limit is reached", async () => {
    vi.stubGlobal("fetch", mockFetch({ saveBlocked: true }));
    const user = userEvent.setup();
    render(<ScenarioSimulatorCard goal={goal()} transactions={weeklyDeposits} formatAmount={formatAmount} />);

    await user.click(screen.getByRole("button", { name: /what if/i }));
    await waitFor(() => expect(screen.getByText(/skip the next deposit/i)).toBeInTheDocument());

    await user.click(screen.getByLabelText(/save scenario: skip the next deposit/i));

    await waitFor(() => expect(screen.getByText(/saved scenario per goal/i)).toBeInTheDocument());
  });

  it("removing a saved scenario calls the delete endpoint and removes it from the list", async () => {
    const fetchMock = mockFetch({
      saved: [
        { id: "s1", goal_id: "g1", scenario_type: "weekly_delta", amount: 30, interval_days: null, label: "Deposit $30/week more", created_at: new Date().toISOString() },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ScenarioSimulatorCard goal={goal()} transactions={weeklyDeposits} formatAmount={formatAmount} />);

    await user.click(screen.getByRole("button", { name: /what if/i }));
    await waitFor(() => expect(screen.getByText("Saved scenarios")).toBeInTheDocument());

    await user.click(screen.getByLabelText(/remove saved scenario/i));

    await waitFor(() => expect(screen.queryByText("Saved scenarios")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/goal/scenario-saved?id=s1"),
      expect.objectContaining({ method: "DELETE" })
    );
  });
});
