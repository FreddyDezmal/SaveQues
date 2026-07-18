/**
 * components/ui/VisibilityBadge.tsx
 *
 * Sprint 22, Phase 12's four visibility levels (private/friends/groups/
 * public — profiles.profile_visibility, activity_visibility,
 * savings_goals.goal_visibility, user_achievements.visibility) as a
 * small icon+text indicator. Note goal_visibility uses the singular
 * 'group' where the others use 'groups' (PRIVACY_AUDIT.md documents this
 * as a known, unfixed naming wart in the backend) — this component
 * accepts both and renders them identically, so the UI doesn't inherit
 * that inconsistency.
 */

import { Lock, Users, UsersRound, Globe } from "lucide-react";

export type VisibilityLevel = "private" | "friends" | "group" | "groups" | "public";

const CONFIG: Record<VisibilityLevel, { label: string; icon: typeof Lock }> = {
  private: { label: "Private", icon: Lock },
  friends: { label: "Friends", icon: Users },
  group:   { label: "Group",   icon: UsersRound },
  groups:  { label: "Group",   icon: UsersRound },
  public:  { label: "Public",  icon: Globe },
};

interface VisibilityBadgeProps {
  visibility: VisibilityLevel;
  className?: string;
}

export default function VisibilityBadge({ visibility, className = "" }: VisibilityBadgeProps) {
  const config = CONFIG[visibility];
  if (!config) return null;
  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium text-white/40 ${className}`}>
      <Icon size={12} aria-hidden="true" />
      {config.label}
    </span>
  );
}
