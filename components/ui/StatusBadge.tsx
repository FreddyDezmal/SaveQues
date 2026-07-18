/**
 * components/ui/StatusBadge.tsx
 *
 * Sprint 22. Every status enum this sprint's backend introduced
 * (friendships, group_members, accountability_partners, group_quests,
 * shared_goal_members, invitations) rendered as a badge that never
 * relies on color alone — each has a distinct icon and visible text, not
 * just a colored dot. Server Component (no interactivity) so it can be
 * used inside both server- and client-rendered lists without forcing a
 * "use client" boundary.
 */

import {
  Clock, Check, X, Ban, UserPlus, Crown, Shield, User as UserIcon,
  LogOut, Trophy, Hourglass, MailQuestion,
} from "lucide-react";

export type BadgeStatus =
  | "pending" | "accepted" | "declined" | "blocked"
  | "invited" | "pending_approval" | "active" | "removed"
  | "completed" | "expired"
  | "redeemed" | "revoked" | "sent" | "opened";

const CONFIG: Record<BadgeStatus, { label: string; icon: typeof Clock; className: string }> = {
  pending:          { label: "Pending",          icon: Clock,         className: "bg-brand-500/15 text-brand-300 border-brand-500/30" },
  sent:             { label: "Sent",              icon: MailQuestion,  className: "bg-brand-500/15 text-brand-300 border-brand-500/30" },
  opened:           { label: "Opened",            icon: MailQuestion,  className: "bg-brand-500/15 text-brand-300 border-brand-500/30" },
  invited:          { label: "Invited",           icon: UserPlus,      className: "bg-brand-500/15 text-brand-300 border-brand-500/30" },
  pending_approval: { label: "Pending approval",  icon: Hourglass,     className: "bg-brand-500/15 text-brand-300 border-brand-500/30" },
  accepted:         { label: "Accepted",          icon: Check,         className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  active:           { label: "Active",            icon: Check,         className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  redeemed:         { label: "Redeemed",          icon: Check,         className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  completed:        { label: "Completed",         icon: Trophy,        className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  declined:         { label: "Declined",          icon: X,             className: "bg-white/10 text-white/50 border-white/15" },
  removed:          { label: "Removed",           icon: LogOut,        className: "bg-white/10 text-white/50 border-white/15" },
  revoked:          { label: "Revoked",           icon: X,             className: "bg-white/10 text-white/50 border-white/15" },
  expired:          { label: "Expired",           icon: Hourglass,     className: "bg-white/10 text-white/50 border-white/15" },
  blocked:          { label: "Blocked",           icon: Ban,           className: "bg-red-500/15 text-red-400 border-red-500/30" },
};

/** Optional role badge (owner/admin/member) shown alongside a status badge in group rosters. */
const ROLE_CONFIG: Record<string, { label: string; icon: typeof Crown }> = {
  owner: { label: "Owner", icon: Crown },
  admin: { label: "Admin", icon: Shield },
  member: { label: "Member", icon: UserIcon },
};

interface StatusBadgeProps {
  status: BadgeStatus;
  className?: string;
}

export default function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  const config = CONFIG[status];
  if (!config) return null;
  const Icon = config.icon;

  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full border ${config.className} ${className}`}
    >
      <Icon size={11} aria-hidden="true" />
      {config.label}
    </span>
  );
}

interface RoleBadgeProps {
  role: "owner" | "admin" | "member";
  className?: string;
}

export function RoleBadge({ role, className = "" }: RoleBadgeProps) {
  const config = ROLE_CONFIG[role];
  if (!config) return null;
  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full border bg-white/5 text-white/60 border-white/10 ${className}`}>
      <Icon size={11} aria-hidden="true" />
      {config.label}
    </span>
  );
}
