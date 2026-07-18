/**
 * components/social/GroupCard.tsx
 *
 * Sprint 22. Renders one entry of GET /api/groups/list's `groups` array
 * (list_my_groups() RPC, 048).
 */

import Link from "next/link";
import { Users, Trophy } from "lucide-react";
import { RoleBadge } from "@/components/ui/StatusBadge";

export interface GroupSummary {
  group_id: string;
  name: string;
  description: string | null;
  emoji: string;
  group_type: string;
  is_active: boolean;
  xp_total: number;
  my_role: "owner" | "admin" | "member";
  member_count: number;
}

export default function GroupCard({ group }: { group: GroupSummary }) {
  return (
    <Link
      href={`/groups/${group.group_id}`}
      className="card p-4 flex items-center gap-3 hover:border-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
    >
      <div className="w-12 h-12 rounded-xl bg-surface-elevated flex items-center justify-center text-2xl shrink-0" aria-hidden="true">
        {group.emoji}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-white truncate">{group.name}</p>
          <RoleBadge role={group.my_role} />
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-white/40">
          <span className="flex items-center gap-1"><Users size={11} aria-hidden="true" /> {group.member_count}</span>
          <span className="flex items-center gap-1"><Trophy size={11} aria-hidden="true" /> {group.xp_total} XP</span>
        </div>
      </div>
    </Link>
  );
}
