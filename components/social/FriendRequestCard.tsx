/**
 * components/social/FriendRequestCard.tsx
 *
 * Sprint 22. Renders one row of pending_incoming or pending_outgoing from
 * GET /api/friends/list. Accept/Decline buttons carry the person's name
 * in their aria-label (not just "Accept"/"Decline") per this sprint's
 * accessibility requirements — a list of several pending requests with
 * generic button labels is exactly the ambiguity that matters for a
 * screen reader user.
 */

import UserAvatar, { UserName } from "./UserAvatar";
import { Check, X } from "lucide-react";

export interface PendingRequest {
  friendship_id: string;
  created_at: string;
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_emoji: string | null;
}

interface FriendRequestCardProps {
  request: PendingRequest;
  direction: "incoming" | "outgoing";
  onAccept?: (friendshipId: string) => Promise<void>;
  onDecline: (friendshipId: string) => Promise<void>;
}

export default function FriendRequestCard({ request, direction, onAccept, onDecline }: FriendRequestCardProps) {
  const name = request.display_name || "Saver";

  return (
    <div className="card p-4 flex items-center gap-3">
      <UserAvatar emoji={request.avatar_emoji} />
      <UserName displayName={request.display_name} username={request.username} className="flex-1 min-w-0" />

      {direction === "incoming" ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onAccept?.(request.friendship_id)}
            aria-label={`Accept ${name}'s friend request`}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
          >
            <Check size={16} />
          </button>
          <button
            type="button"
            onClick={() => onDecline(request.friendship_id)}
            aria-label={`Decline ${name}'s friend request`}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-white/5 text-white/50 hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          >
            <X size={16} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onDecline(request.friendship_id)}
          aria-label={`Cancel your friend request to ${name}`}
          className="text-xs text-white/40 hover:text-white/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 rounded-lg px-3 py-2"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
