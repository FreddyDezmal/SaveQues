/**
 * components/social/ActivityFeedCard.tsx
 *
 * Sprint 22. Renders one item of GET /api/feed (get_activity_feed, 051).
 * Every event_type this backend actually produces is handled explicitly
 * — no fallback that guesses at a shape the API doesn't send. metadata
 * never contains a financial figure (051's CHECK constraint enforces
 * this at the DB level, not just by convention), so nothing here needs
 * to defensively hide an amount.
 */

"use client";

import { useState } from "react";
import { Target, TrendingUp, Award, Flame, Users, Trophy, X } from "lucide-react";
import UserAvatar from "./UserAvatar";

export interface FeedItem {
  id: string;
  actor_id: string;
  actor_username: string | null;
  actor_display_name: string | null;
  actor_avatar_emoji: string | null;
  group_id: string | null;
  group_name: string | null;
  event_type: "goal_completed" | "level_up" | "achievement_unlocked" | "streak_milestone" | "group_joined" | "group_quest_completed";
  metadata: Record<string, any>;
  visibility: string;
  created_at: string;
}

const EVENT_CONFIG: Record<FeedItem["event_type"], { icon: typeof Target }> = {
  goal_completed: { icon: Target },
  level_up: { icon: TrendingUp },
  achievement_unlocked: { icon: Award },
  streak_milestone: { icon: Flame },
  group_joined: { icon: Users },
  group_quest_completed: { icon: Trophy },
};

function describe(item: FeedItem): string {
  const name = item.actor_display_name || "Someone";
  switch (item.event_type) {
    case "goal_completed": return `${name} completed "${item.metadata.goal_title}" ${item.metadata.goal_emoji || "🎉"}`;
    case "level_up": return `${name} reached Level ${item.metadata.new_level}${item.metadata.new_title ? ` — ${item.metadata.new_title}` : ""}`;
    case "achievement_unlocked": return `${name} unlocked an achievement`;
    case "streak_milestone": return `${name} hit a ${item.metadata.streak_days}-day streak`;
    case "group_joined": return `${name} joined ${item.metadata.group_name || item.group_name || "a group"}`;
    case "group_quest_completed": return `${item.metadata.quest_title ? `"${item.metadata.quest_title}" completed` : "A group quest was completed"} in ${item.group_name || "the group"}`;
    default: return `${name} had an update`;
  }
}

interface ActivityFeedCardProps {
  item: FeedItem;
  isOwn: boolean;
  onHide: (id: string) => Promise<void>;
}

export default function ActivityFeedCard({ item, isOwn, onHide }: ActivityFeedCardProps) {
  const [hiding, setHiding] = useState(false);
  const Icon = EVENT_CONFIG[item.event_type]?.icon ?? Target;

  return (
    <div className="card p-4 flex items-start gap-3">
      <UserAvatar emoji={item.actor_avatar_emoji} size="sm" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white leading-snug">{describe(item)}</p>
        <div className="flex items-center gap-1.5 mt-1 text-xs text-white/40">
          <Icon size={11} aria-hidden="true" />
          <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time>
        </div>
      </div>
      {isOwn && (
        <button
          type="button"
          onClick={async () => { setHiding(true); await onHide(item.id); }}
          disabled={hiding}
          aria-label="Hide this post from your activity feed"
          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-white/20 hover:text-white/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 shrink-0 -m-2.5"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
