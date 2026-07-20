/**
 * tests/component/UserAvatar.test.tsx
 *
 * Sprint 22 — Phase 16. Tests components/social/UserAvatar.tsx
 * (UserAvatar and the co-located UserName), the shared renderer for the
 * safe-column profile shape used across every social API response.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import UserAvatar, { UserName } from "@/components/social/UserAvatar";

describe("UserAvatar", () => {
  it("renders the given emoji", () => {
    render(<UserAvatar emoji="🚀" />);
    expect(screen.getByText("🚀")).toBeInTheDocument();
  });

  it("falls back to a default emoji when none is given", () => {
    render(<UserAvatar emoji={null} />);
    expect(screen.getByText("🙂")).toBeInTheDocument();
  });

  it("falls back to the default emoji for an empty string too", () => {
    // "" is falsy, so the `emoji || "🙂"` fallback should catch it, not
    // render a blank circle.
    render(<UserAvatar emoji="" />);
    expect(screen.getByText("🙂")).toBeInTheDocument();
  });

  it("is decorative: hidden from the accessibility tree", () => {
    const { container } = render(<UserAvatar emoji="🚀" />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  it("applies the size class for the requested size", () => {
    const { container } = render(<UserAvatar emoji="🚀" size="lg" />);
    expect(container.firstChild).toHaveClass("w-14", "h-14");
  });

  it("defaults to the medium size when none is specified", () => {
    const { container } = render(<UserAvatar emoji="🚀" />);
    expect(container.firstChild).toHaveClass("w-10", "h-10");
  });
});

describe("UserName", () => {
  it("renders the display name and @username", () => {
    render(<UserName displayName="Alex Saver" username="alexsaver" />);
    expect(screen.getByText("Alex Saver")).toBeInTheDocument();
    expect(screen.getByText("@alexsaver")).toBeInTheDocument();
  });

  it("falls back to 'Saver' when displayName is missing", () => {
    render(<UserName displayName={null} username="alexsaver" />);
    expect(screen.getByText("Saver")).toBeInTheDocument();
  });

  it("omits the @username line entirely when no username is given", () => {
    render(<UserName displayName="Alex Saver" username={null} />);
    expect(screen.queryByText(/^@/)).not.toBeInTheDocument();
  });
});
