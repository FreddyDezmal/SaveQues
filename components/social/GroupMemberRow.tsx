"use client";

/**
 * components/social/GroupMemberRow.tsx
 *
 * Sprint 22. Renders one row of GET /api/groups/members's response
 * (get_group_members() RPC, 048). Role/status change actions only show
 * for callers with owner/admin privileges — the backend (048's
 * enforce_group_member_transition trigger) is the real authority here,
 * this is just not offering controls that would fail anyway.
 */

import { useState } from "react";
import { Shield, UserMinus } from "lucide-react";
import UserAvatar, { UserName } from "./UserAvatar";
import StatusBadge, { RoleBadge, type BadgeStatus } from "@/components/ui/StatusBadge";
import ConfirmationModal from "@/components/ui/ConfirmationModal";

export interface GroupMember {
  member_id: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_emoji: string | null;
  current_level: number;
  role: "owner" | "admin" | "member";
  status: string;
  invited_by: string | null;
  created_at: string;
  responded_at: string | null;
}

interface GroupMemberRowProps {
  member: GroupMember;
  /** Whether the CALLER (viewing this list) is owner/admin — enables management actions on other members. */
  canManage: boolean;
  onChangeRole: (memberId: string, role: "admin" | "member") => Promise<void>;
  onRemove: (memberId: string) => Promise<void>;
}

export default function GroupMemberRow({ member, canManage, onChangeRole, onRemove }: GroupMemberRowProps) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const name = member.display_name || "Saver";
  const canModifyThisMember = canManage && member.role !== "owner";

  return (
    <div className="card p-4 flex items-center gap-3">
      <UserAvatar emoji={member.avatar_emoji} />
      <UserName displayName={member.display_name} username={member.username} className="flex-1 min-w-0" />
      <RoleBadge role={member.role} />
      {member.status !== "active" && <StatusBadge status={member.status as BadgeStatus} />}

      {canModifyThisMember && (
        <div className="flex items-center gap-1.5">
          {member.status === "active" && (
            <button
              type="button"
              onClick={() => onChangeRole(member.member_id, member.role === "admin" ? "member" : "admin")}
              aria-label={member.role === "admin" ? `Remove admin from ${name}` : `Make ${name} an admin`}
              className="p-2 rounded-lg text-white/40 hover:text-white/70 hover:bg-surface-elevated transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              <Shield size={15} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setConfirmRemove(true)}
            aria-label={`Remove ${name} from the group`}
            className="p-2 rounded-lg text-white/40 hover:text-red-400 hover:bg-surface-elevated transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          >
            <UserMinus size={15} />
          </button>
        </div>
      )}

      <ConfirmationModal
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={() => onRemove(member.member_id)}
        title="Remove this member?"
        description={`${name} will be removed from the group and can be re-invited later.`}
        confirmLabel="Remove"
        confirmAriaLabel={`Remove ${name} from the group`}
      />
    </div>
  );
}
