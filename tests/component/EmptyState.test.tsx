/**
 * tests/component/EmptyState.test.tsx
 *
 * Sprint 18 — Phase 4. Tests components/ui/EmptyState.tsx — notably its
 * `bare` prop (Sprint 16, added specifically to avoid a double-card look
 * when embedded inside NotificationCenter's panel) and optional action
 * icon (Sprint 16, added when GoalHistoryClient was migrated to this
 * component so it wouldn't lose its existing icon+label CTA).
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import EmptyState from "@/components/ui/EmptyState";

describe("EmptyState", () => {
  it("renders the emoji, title, and description", () => {
    render(<EmptyState emoji="🎯" title="No goals yet" description="Create your first goal." />);
    expect(screen.getByText("🎯")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No goals yet" })).toBeInTheDocument();
    expect(screen.getByText("Create your first goal.")).toBeInTheDocument();
  });

  it("renders no action link when none is provided", () => {
    render(<EmptyState emoji="🔔" title="No notifications" description="Nothing yet." />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders the action as a link with the correct href and label when provided", () => {
    render(
      <EmptyState
        emoji="🎯"
        title="No goals yet"
        description="Create your first goal."
        action={{ label: "Create My First Goal", href: "/goals/new" }}
      />
    );
    const link = screen.getByRole("link", { name: /Create My First Goal/ });
    expect(link).toHaveAttribute("href", "/goals/new");
  });

  it("applies the default card wrapper classes when bare is not set", () => {
    const { container } = render(<EmptyState emoji="🎯" title="T" description="D" />);
    expect(container.firstChild).toHaveClass("card");
  });

  it("omits the card wrapper classes in bare mode, to avoid a double-border look when nested in another panel", () => {
    const { container } = render(<EmptyState emoji="🎯" title="T" description="D" bare />);
    expect(container.firstChild).not.toHaveClass("card");
  });

  it("applies additional className alongside the base classes", () => {
    const { container } = render(<EmptyState emoji="🎯" title="T" description="D" className="mt-12" />);
    expect(container.firstChild).toHaveClass("mt-12");
  });
});
