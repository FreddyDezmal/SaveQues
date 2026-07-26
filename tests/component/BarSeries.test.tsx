/**
 * tests/component/BarSeries.test.tsx
 *
 * Sprint 27 — Phase 12 (Accessibility). Tests the fix to
 * app/(app)/digest/[id]/DigestClient.tsx's BarSeries — before this
 * phase it had zero screen-reader-accessible content (only a mouse-hover
 * `title` tooltip). These tests pin down the fix: a role="img" summary
 * and a visually-hidden data table, so this doesn't silently regress.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BarSeries } from "@/app/(app)/digest/[id]/DigestClient";

describe("BarSeries", () => {
  it("renders an empty-state message with no crash when there are no points", () => {
    render(<BarSeries points={[]} colorClass="bg-brand-500" seriesLabel="Savings" />);
    expect(screen.getByText(/No activity in this period yet/)).toBeInTheDocument();
  });

  it("exposes an accessible role='img' summary naming the series, total, and peak day", () => {
    render(
      <BarSeries
        points={[
          { date: "2026-07-01", value: 100 },
          { date: "2026-07-02", value: 300 },
        ]}
        colorClass="bg-brand-500"
        seriesLabel="Savings"
      />
    );
    const img = screen.getByRole("img");
    expect(img.getAttribute("aria-label")).toContain("Savings");
    expect(img.getAttribute("aria-label")).toContain("400"); // total
    expect(img.getAttribute("aria-label")).toContain("2026-07-02"); // peak day
    expect(img.getAttribute("aria-label")).toContain("300"); // peak value
  });

  it("provides a screen-reader-only data table with every point, not just the visual bars", () => {
    render(
      <BarSeries
        points={[
          { date: "2026-07-01", value: 100 },
          { date: "2026-07-02", value: 300 },
        ]}
        colorClass="bg-brand-500"
        seriesLabel="Savings"
      />
    );
    // The visual bar chart itself is hidden from the accessibility tree...
    const chart = document.querySelector('[aria-hidden="true"]');
    expect(chart).toBeInTheDocument();
    // ...but the same two data points are present in a real <table> a
    // screen reader can navigate.
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("2026-07-01")).toBeInTheDocument();
    expect(screen.getByText("2026-07-02")).toBeInTheDocument();
  });
});
