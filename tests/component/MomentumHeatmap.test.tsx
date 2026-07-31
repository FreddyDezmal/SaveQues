/**
 * tests/component/MomentumHeatmap.test.tsx
 * Sprint 28.5 — Phase 6/10/11.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MomentumHeatmap from "@/components/gamification/MomentumHeatmap";
import { getUTCDateString, getLastNUTCDateStrings } from "@/lib/dateUtils";

function activityLog(activeDayCount: number, daysBack: number) {
  const dates = getLastNUTCDateStrings(daysBack);
  return dates.slice(0, activeDayCount).map((date) => ({ date, xp_earned: 150, actions_count: 1 }));
}

describe("MomentumHeatmap — accessibility (Sprint 28.5 Phase 6/10 fix)", () => {
  it("provides a single sr-only summary sentence carrying the same numbers shown visually", () => {
    render(<MomentumHeatmap activityLog={activityLog(12, 30)} userStage="established" />);
    // The visible sub-label already renders "12/30 days active" in text —
    // the sr-only summary should carry the same figures, not different ones.
    expect(screen.getByText(/12\/30 days active/i)).toBeInTheDocument();
    const summary = document.querySelector(".sr-only");
    expect(summary).not.toBeNull();
    expect(summary!.textContent).toMatch(/12 of 30 days active/i);
  });

  it("hides the decorative day grid from assistive tech, relying on the text summary instead", () => {
    const { container } = render(<MomentumHeatmap activityLog={activityLog(5, 30)} userStage="established" />);
    const grid = container.querySelector('[style*="grid-template-columns"]');
    expect(grid).not.toBeNull();
    expect(grid).toHaveAttribute("aria-hidden", "true");
  });

  it("hides the decorative color-intensity legend from assistive tech", () => {
    render(<MomentumHeatmap activityLog={activityLog(5, 30)} userStage="established" />);
    const lessLabel = screen.getByText("Less");
    // The legend row (parent) should be hidden from AT — its meaning is
    // already covered by the sr-only summary and the momentum description.
    expect(lessLabel.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("keeps the momentum description as regular, non-hidden text", () => {
    render(<MomentumHeatmap activityLog={activityLog(0, 30)} userStage="established" />);
    // Zero active days still has a momentum description rendered as plain text.
    const paragraphs = screen.getAllByText(/./, { selector: "p" });
    expect(paragraphs.some((p) => !p.className.includes("sr-only") && p.textContent && p.textContent.length > 0)).toBe(true);
  });

  it("still renders the visible day count for sighted users using the 14-day window for a 'building' stage user", () => {
    render(<MomentumHeatmap activityLog={activityLog(3, 14)} userStage="building" />);
    expect(screen.getByText(/3\/14 days active/i)).toBeInTheDocument();
    expect(screen.getByText("14-Day Momentum")).toBeInTheDocument();
  });
});
