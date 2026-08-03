/**
 * tests/component/PremiumForecastCard.test.tsx
 * Sprint 30 — Phase 2/13: Premium Forecast card.
 * Sprint 30 — Phase 12: mocks useFeatureEntitlement (the shared hook this
 * card and PremiumCoachingCard now both use) rather than useBillingStatus
 * directly, since the duplicated inline entitlement expression was
 * extracted into that hook.
 *
 * Follows the same fixture convention as FinancialHealthCard.test.tsx
 * (same CashFlowProjection shape).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CashFlowProjection } from "@/lib/cashFlowProjection";

const formatAmount = (n: number) => `R${n.toFixed(2)}`;

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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const mockUseFeatureEntitlement = vi.fn();
vi.mock("@/lib/hooks/useFeatureEntitlement", () => ({
  useFeatureEntitlement: (key: string) => mockUseFeatureEntitlement(key),
}));

import PremiumForecastCard from "@/components/insights/PremiumForecastCard";

describe("PremiumForecastCard", () => {
  beforeEach(() => {
    mockUseFeatureEntitlement.mockReset();
  });

  it("renders nothing when cashFlow is null", () => {
    mockUseFeatureEntitlement.mockReturnValue({ entitled: false, loading: false });
    const { container } = render(<PremiumForecastCard cashFlow={null} formatAmount={formatAmount} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when there isn't enough history to project from", () => {
    mockUseFeatureEntitlement.mockReturnValue({ entitled: false, loading: false });
    const { container } = render(
      <PremiumForecastCard cashFlow={cashFlow({ weeklyPace: null })} formatAmount={formatAmount} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when insufficientDataReason is set, even with a pace present", () => {
    mockUseFeatureEntitlement.mockReturnValue({ entitled: false, loading: false });
    const { container } = render(
      <PremiumForecastCard cashFlow={cashFlow({ insufficientDataReason: "not enough deposits" })} formatAmount={formatAmount} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the locked-card preview (not the raw numbers unlocked) for a free user", () => {
    mockUseFeatureEntitlement.mockReturnValue({ entitled: false, loading: false });
    render(<PremiumForecastCard cashFlow={cashFlow()} formatAmount={formatAmount} />);
    expect(screen.getByText("Upgrade to Premium")).toBeInTheDocument();
  });

  it("fails toward the locked appearance while billing status is still loading", () => {
    mockUseFeatureEntitlement.mockReturnValue({ entitled: false, loading: true });
    render(<PremiumForecastCard cashFlow={cashFlow()} formatAmount={formatAmount} />);
    expect(screen.getByText("Upgrade to Premium")).toBeInTheDocument();
  });

  it("shows the full 30/60/90-day breakdown for an entitled premium user", () => {
    mockUseFeatureEntitlement.mockReturnValue({ entitled: true, loading: false });
    render(<PremiumForecastCard cashFlow={cashFlow()} formatAmount={formatAmount} />);
    expect(screen.queryByText("Upgrade to Premium")).not.toBeInTheDocument();
    expect(screen.getByText("30 days")).toBeInTheDocument();
    expect(screen.getByText("60 days")).toBeInTheDocument();
    expect(screen.getByText("90 days")).toBeInTheDocument();
    expect(screen.getByText("R1400.00")).toBeInTheDocument();
    expect(screen.getByText("R1800.00")).toBeInTheDocument();
    expect(screen.getByText("R2200.00")).toBeInTheDocument();
  });

  it("asks useFeatureEntitlement for the correct feature key", () => {
    mockUseFeatureEntitlement.mockReturnValue({ entitled: true, loading: false });
    render(<PremiumForecastCard cashFlow={cashFlow()} formatAmount={formatAmount} />);
    expect(mockUseFeatureEntitlement).toHaveBeenCalledWith("advanced_forecasting");
  });

  it("exposes the entitled card as an accessible region labelled by its own heading (Sprint 30 Phase 11)", () => {
    mockUseFeatureEntitlement.mockReturnValue({ entitled: true, loading: false });
    render(<PremiumForecastCard cashFlow={cashFlow()} formatAmount={formatAmount} />);
    // Only resolves if the section's aria-labelledby id actually matches a
    // real element's id — silently fails to find a named region otherwise,
    // which is exactly the bug this test would have caught before the fix.
    expect(screen.getByRole("region", { name: "Premium Forecast" })).toBeInTheDocument();
  });
});
