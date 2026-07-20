/**
 * tests/component/FriendRequestCard.test.tsx
 *
 * Sprint 22 — Phase 16. Tests components/social/FriendRequestCard.tsx.
 * Focus is the incoming/outgoing branch (different actions, different
 * aria-labels) and that each button's accessible name names the person,
 * per this component's stated accessibility requirement — a list of
 * several pending requests with generic "Accept"/"Decline" labels is
 * exactly the ambiguity that matters for a screen reader user.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FriendRequestCard, { type PendingRequest } from "@/components/social/FriendRequestCard";

function request(overrides: Partial<PendingRequest> = {}): PendingRequest {
  return {
    friendship_id: "f1",
    created_at: new Date().toISOString(),
    id: "u2",
    username: "sarahsaver",
    display_name: "Sarah",
    avatar_emoji: "🐷",
    ...overrides,
  };
}

describe("FriendRequestCard — incoming", () => {
  it("renders Accept and Decline buttons, each naming the requester", () => {
    render(
      <FriendRequestCard request={request()} direction="incoming" onAccept={vi.fn()} onDecline={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: "Accept Sarah's friend request" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline Sarah's friend request" })).toBeInTheDocument();
  });

  it("calls onAccept with the friendship_id when Accept is clicked", async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn().mockResolvedValue(undefined);
    render(
      <FriendRequestCard request={request()} direction="incoming" onAccept={onAccept} onDecline={vi.fn()} />
    );
    await user.click(screen.getByRole("button", { name: "Accept Sarah's friend request" }));
    expect(onAccept).toHaveBeenCalledWith("f1");
  });

  it("calls onDecline with the friendship_id when Decline is clicked", async () => {
    const user = userEvent.setup();
    const onDecline = vi.fn().mockResolvedValue(undefined);
    render(
      <FriendRequestCard request={request()} direction="incoming" onAccept={vi.fn()} onDecline={onDecline} />
    );
    await user.click(screen.getByRole("button", { name: "Decline Sarah's friend request" }));
    expect(onDecline).toHaveBeenCalledWith("f1");
  });

  it("falls back to 'Saver' in the aria-label when display_name is missing", () => {
    render(
      <FriendRequestCard
        request={request({ display_name: null })}
        direction="incoming"
        onAccept={vi.fn()}
        onDecline={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "Accept Saver's friend request" })).toBeInTheDocument();
  });
});

describe("FriendRequestCard — outgoing", () => {
  it("renders only a Cancel action, with no Accept button", () => {
    render(<FriendRequestCard request={request()} direction="outgoing" onDecline={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Accept/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel your friend request to Sarah" })).toBeInTheDocument();
  });

  it("calls onDecline with the friendship_id when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const onDecline = vi.fn().mockResolvedValue(undefined);
    render(<FriendRequestCard request={request()} direction="outgoing" onDecline={onDecline} />);
    await user.click(screen.getByRole("button", { name: "Cancel your friend request to Sarah" }));
    expect(onDecline).toHaveBeenCalledWith("f1");
  });
});
