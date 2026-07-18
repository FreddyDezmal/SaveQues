/**
 * components/social/LeaderboardRow.tsx
 *
 * Sprint 22. Generic row for every leaderboard metric this sprint's
 * backend exposes (052) — no rank-movement indicator, because none of
 * leaderboard_xp/streak/goals_completed/group_contributions/my_groups
 * track or return a previous rank to compare against. Adding one here
 * would mean inventing data the API doesn't provide.
 */

import UserAvatar, { UserName } from "./UserAvatar";

interface LeaderboardRowProps {
  rank: number;
  avatarEmoji?: string | null;
  displayName?: string | null;
  username?: string | null;
  /** Formatted value + its accessible label, e.g. value="1,240 XP" srLabel="1,240 experience points" */
  value: string;
  isSelf?: boolean;
}

export default function LeaderboardRow({ rank, avatarEmoji, displayName, username, value, isSelf }: LeaderboardRowProps) {
  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl ${isSelf ? "bg-brand-500/10 border border-brand-500/30" : ""}`}>
      <span className="w-6 text-center text-sm font-display font-semibold text-white/50 shrink-0" aria-hidden="true">{rank}</span>
      <UserAvatar emoji={avatarEmoji} size="sm" />
      <UserName displayName={displayName} username={username} className="flex-1 min-w-0" />
      <span className="text-sm font-medium text-white shrink-0">{value}</span>
      <span className="sr-only">rank {rank}</span>
    </div>
  );
}
