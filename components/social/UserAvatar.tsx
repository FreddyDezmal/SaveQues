/**
 * components/social/UserAvatar.tsx
 *
 * Sprint 22. Every social API response carries the same safe-column
 * profile card shape (id, username, display_name, avatar_emoji —
 * see e.g. get_friend_profile, get_group_members, get_activity_feed).
 * One renderer for that shape instead of every list re-implementing the
 * emoji-in-a-circle markup.
 */

const SIZE_CLASSES = {
  sm: "w-8 h-8 text-base",
  md: "w-10 h-10 text-lg",
  lg: "w-14 h-14 text-2xl",
} as const;

interface UserAvatarProps {
  emoji?: string | null;
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
}

export default function UserAvatar({ emoji, size = "md", className = "" }: UserAvatarProps) {
  return (
    <div
      className={`shrink-0 rounded-full bg-surface-elevated border border-surface-border flex items-center justify-center ${SIZE_CLASSES[size]} ${className}`}
      aria-hidden="true"
    >
      {emoji || "🙂"}
    </div>
  );
}

interface UserNameProps {
  displayName?: string | null;
  username?: string | null;
  className?: string;
}

export function UserName({ displayName, username, className = "" }: UserNameProps) {
  return (
    <div className={className}>
      <p className="text-sm font-medium text-white truncate">{displayName || "Saver"}</p>
      {username && <p className="text-xs text-white/40 truncate">@{username}</p>}
    </div>
  );
}
