/**
 * tests/component/LeaderboardRow.test.tsx
 *
 * Sprint 22 — Phase 16. Tests components/social/LeaderboardRow.tsx.
 * Note: this component deliberately has no rank-movement indicator — see
 * its file header — because the leaderboard_* RPCs (052) don't return a
 * previous rank to diff against. No test here should assume one exists.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LeaderboardRow from "@/components/social/LeaderboardRow";

describe("LeaderboardRow", () => {
  it("renders rank, name, and the formatted value", () => {
    render(
      <LeaderboardRow rank={3} displayName="Sarah" username="sarahsaver" value="1,240 XP" />
    );
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Sarah")).toBeInTheDocument();
    expect(screen.getByText("1,240 XP")).toBeInTheDocument();
  });

  it("exposes the rank to assistive tech via a visually-hidden label", () => {
    render(<LeaderboardRow rank={1} displayName="Sarah" value="1,240 XP" />);
    expect(screen.getByText("rank 1")).toHaveClass("sr-only");
  });

  it("does not apply the self-highlight styling by default", () => {
    const { container } = render(<LeaderboardRow rank={2} displayName="Mike" value="800 XP" />);
    expect(container.firstChild).not.toHaveClass("bg-brand-500/10");
  });

  it("applies the self-highlight styling when isSelf is true", () => {
    const { container } = render(
      <LeaderboardRow rank={2} displayName="Mike" value="800 XP" isSelf />
    );
    expect(container.firstChild).toHaveClass("bg-brand-500/10");
  });

  it("falls back to the default avatar and name when profile fields are missing", () => {
    render(<LeaderboardRow rank={5} value="3-week streak" />);
    expect(screen.getByText("🙂")).toBeInTheDocument();
    expect(screen.getByText("Saver")).toBeInTheDocument();
  });
});
