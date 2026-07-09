/**
 * tests/component/Skeleton.test.tsx
 *
 * Sprint 18 — Phase 4. Tests components/ui/Skeleton.tsx. Small component,
 * but the accessibility property (aria-hidden) is the one thing actually
 * worth pinning — a loading placeholder that a screen reader announces as
 * content is a real, if minor, regression risk.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import Skeleton, { GoalCardSkeleton } from "@/components/ui/Skeleton";

describe("Skeleton", () => {
  it("is hidden from assistive technology (aria-hidden)", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  it("renders a rounded rectangle by default", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toHaveClass("rounded-lg");
    expect(container.firstChild).not.toHaveClass("rounded-full");
  });

  it("renders a circle when circle prop is set (for avatar/icon placeholders)", () => {
    const { container } = render(<Skeleton circle />);
    expect(container.firstChild).toHaveClass("rounded-full");
  });

  it("applies the shimmer animation class", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toHaveClass("shimmer");
  });
});

describe("GoalCardSkeleton", () => {
  it("renders without crashing and includes a circular avatar placeholder", () => {
    const { container } = render(<GoalCardSkeleton />);
    const circle = container.querySelector(".rounded-full");
    expect(circle).not.toBeNull();
  });
});
