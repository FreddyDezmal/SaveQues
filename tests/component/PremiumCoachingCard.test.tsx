/**
 * tests/component/PremiumCoachingCard.test.tsx
 * Sprint 30 — Phase 7/13: Premium Coaching.
 * Sprint 30 — Phase 12: mocks the shared useFeatureEntitlement hook (see
 * that hook's own header for why the inline expression was extracted).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CoachingMessage } from "@/lib/coaching";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const mockUseFeatureEntitlement = vi.fn();
vi.mock("@/lib/hooks/useFeatureEntitlement", () => ({
  useFeatureEntitlement: (key: string) => mockUseFeatureEntitlement(key),
}));

import PremiumCoachingCard from "@/components/insights/PremiumCoachingCard";

function msg(overrides: Partial<CoachingMessage>): CoachingMessage {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    message: "You're doing great.",
    priority: 5,
    ...overrides,
  };
}

const messages: CoachingMessage[] = [
  msg({ id: "m1", message: "Message one" }),
  msg({ id: "m2", message: "Message two" }),
  msg({ id: "m3", message: "Message three", goalId: "g1" }),
  msg({ id: "m4", message: "Message four", goalId: "g2" }),
];

describe("PremiumCoachingCard", () => {
  beforeEach(() => {
    mockUseFeatureEntitlement.mockReset();
  });

  it("renders nothing when there is nothing beyond what's already free", () => {
    mockUseFeatureEntitlement.mockReturnValue({ entitled: false, loading: false });
    const { container } = render(<PremiumCoachingCard messages={messages.slice(0, 2)} alreadyFreeCount={2} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the locked-card preview for a free user, not the raw remaining messages unlocked", () => {
    mockUseFeatureEntitlement.mockReturnValue({ entitled: false, loading: false });
    render(<PremiumCoachingCard messages={messages} alreadyFreeCount={1} />);
    expect(screen.getByText("Upgrade to Premium")).toBeInTheDocument();
    expect(screen.getByText(/3 more personalized coaching insights/i)).toBeInTheDocument();
  });

  it("fails toward the locked appearance while billing status is still loading", () => {
    mockUseFeatureEntitlement.mockReturnValue({ entitled: false, loading: true });
    render(<PremiumCoachingCard messages={messages} alreadyFreeCount={1} />);
    expect(screen.getByText("Upgrade to Premium")).toBeInTheDocument();
  });

  it("shows only the messages beyond alreadyFreeCount for an entitled premium user — not the ones already free", () => {
    mockUseFeatureEntitlement.mockReturnValue({ entitled: true, loading: false });
    render(<PremiumCoachingCard messages={messages} alreadyFreeCount={2} />);
    expect(screen.queryByText("Upgrade to Premium")).not.toBeInTheDocument();
    // "Message one" is messages[0] — it legitimately still appears via the
    // "This week's focus" line (same content already free elsewhere,
    // just restyled), but should not be duplicated in the remaining list.
    expect(screen.getByText("This week's focus:")).toBeInTheDocument();
    expect(screen.queryByText("Message two")).not.toBeInTheDocument();
    expect(screen.getByText("Message three")).toBeInTheDocument();
    expect(screen.getByText("Message four")).toBeInTheDocument();
  });

  it("asks useFeatureEntitlement for the correct feature key", () => {
    mockUseFeatureEntitlement.mockReturnValue({ entitled: true, loading: false });
    render(<PremiumCoachingCard messages={messages} alreadyFreeCount={1} />);
    expect(mockUseFeatureEntitlement).toHaveBeenCalledWith("ai_coaching");
  });

  it("prefixes a message with its goal's title when goalTitles is provided", () => {
    mockUseFeatureEntitlement.mockReturnValue({ entitled: true, loading: false });
    render(
      <PremiumCoachingCard
        messages={messages}
        alreadyFreeCount={2}
        goalTitles={{ g1: "Emergency Fund", g2: "Trip to Cape Town" }}
      />
    );
    expect(screen.getByText("Emergency Fund:")).toBeInTheDocument();
    expect(screen.getByText("Trip to Cape Town:")).toBeInTheDocument();
  });

  it("shows the top message as this week's focus and an optional trend explanation", () => {
    mockUseFeatureEntitlement.mockReturnValue({ entitled: true, loading: false });
    render(
      <PremiumCoachingCard
        messages={messages}
        alreadyFreeCount={1}
        trendExplanation="Your saving pace has been picking up over the last month."
      />
    );
    expect(screen.getByText("Message one")).toBeInTheDocument(); // appears in the focus line
    expect(screen.getByText(/saving pace has been picking up/i)).toBeInTheDocument();
  });

  it("exposes the entitled card as an accessible region labelled by its own heading (Sprint 30 Phase 11)", () => {
    mockUseFeatureEntitlement.mockReturnValue({ entitled: true, loading: false });
    render(<PremiumCoachingCard messages={messages} alreadyFreeCount={1} />);
    expect(screen.getByRole("region", { name: "Your coaching plan" })).toBeInTheDocument();
  });
});
