/**
 * components/social/FriendCard.tsx
 *
 * Sprint 22. Renders one row of GET /api/friends/list's `friends` array
 * (list_friends() RPC, 046) — safe profile card fields only (level, XP,
 * streak), never a financial figure, matching that RPC's own scope.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { MoreVertical, Flame } from "lucide-react";
import UserAvatar, { UserName } from "./UserAvatar";
import ConfirmationModal from "@/components/ui/ConfirmationModal";

export interface Friend {
  friendship_id: string;
  since: string | null;
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_emoji: string | null;
  current_level: number;
  xp_total: number;
  streak_days: number;
  longest_streak: number;
}

interface FriendCardProps {
  friend: Friend;
  onRemove: (friendshipId: string) => Promise<void>;
  onBlock: (userId: string) => Promise<void>;
}

export default function FriendCard({ friend, onRemove, onBlock }: FriendCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"remove" | "block" | null>(null);
  const name = friend.display_name || "Saver";
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Real Escape-to-close and click-outside-to-close — the previous
  // onMouseLeave-only version never worked for keyboard users at all.
  // No role="menu"/"menuitem" here on purpose: that role obligates the
  // full ARIA Authoring Practices menu pattern (arrow-key roving
  // tabindex, Home/End, typeahead) which this component never
  // implemented — jsx-a11y/interactive-supports-focus caught that gap.
  // This is the simpler, fully-correct WAI-ARIA "disclosure" pattern
  // instead: a plain toggleable panel of ordinary buttons, each already
  // reachable by Tab, needing no special role at all.
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) && e.target !== triggerRef.current) {
        setMenuOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  async function handleConfirm() {
    if (confirmAction === "remove") await onRemove(friend.friendship_id);
    if (confirmAction === "block") await onBlock(friend.id);
    setConfirmAction(null);
  }

  return (
    <div className="card p-4 flex items-center gap-3">
      <UserAvatar emoji={friend.avatar_emoji} size="lg" />
      <div className="flex-1 min-w-0">
        <UserName displayName={friend.display_name} username={friend.username} />
        <div className="flex items-center gap-3 mt-1 text-xs text-white/40">
          <span>Level {friend.current_level}</span>
          <span className="flex items-center gap-1">
            <Flame size={11} className="text-brand-400" aria-hidden="true" />
            {friend.streak_days}d streak
          </span>
        </div>
      </div>

      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-label={`More actions for ${name}`}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-white/40 hover:text-white/70 hover:bg-surface-elevated transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
        >
          <MoreVertical size={16} />
        </button>
        {menuOpen && (
          <div
            ref={menuRef}
            className="absolute right-0 top-full mt-1 w-40 card p-1 z-10 shadow-xl"
          >
            <button
              type="button"
              onClick={() => { setMenuOpen(false); setConfirmAction("remove"); }}
              className="w-full text-left text-sm text-white/70 hover:bg-surface-elevated rounded-lg px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              Remove friend
            </button>
            <button
              type="button"
              onClick={() => { setMenuOpen(false); setConfirmAction("block"); }}
              className="w-full text-left text-sm text-red-400 hover:bg-surface-elevated rounded-lg px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              Block
            </button>
          </div>
        )}
      </div>

      <ConfirmationModal
        open={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleConfirm}
        title={confirmAction === "block" ? "Block this friend?" : "Remove this friend?"}
        description={
          confirmAction === "block"
            ? `${name} won't be able to see your profile or send you requests. You can unblock them later from Settings.`
            : `${name} will be removed from your friends list. You can send a new request later if you change your mind.`
        }
        confirmLabel={confirmAction === "block" ? "Block" : "Remove"}
        confirmAriaLabel={confirmAction === "block" ? `Block ${name}` : `Remove ${name} as a friend`}
      />
    </div>
  );
}
