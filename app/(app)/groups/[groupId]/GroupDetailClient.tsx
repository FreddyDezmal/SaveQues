"use client";

/**
 * app/(app)/groups/[groupId]/GroupDetailClient.tsx
 *
 * Sprint 22. Group header data is derived from GET /api/groups/list
 * (finding the matching group_id client-side) rather than a new
 * GET /api/groups/[id] route — this sprint's backend is fixed, and
 * list_my_groups() already returns everything the header needs (name,
 * description, emoji, xp_total, my_role), so a second endpoint would be
 * duplicate business logic for the same data.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings, UserPlus, Trophy, LogOut, Trash2, Check, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { GroupSummary } from "@/components/social/GroupCard";
import GroupMemberRow, { type GroupMember } from "@/components/social/GroupMemberRow";
import GroupQuestCard, { type GroupQuest } from "@/components/social/GroupQuestCard";
import InviteModal from "@/components/social/InviteModal";
import CreateGroupQuestModal from "@/components/social/CreateGroupQuestModal";
import GroupSettingsModal from "@/components/social/GroupSettingsModal";
import ConfirmationModal from "@/components/ui/ConfirmationModal";
import ErrorState from "@/components/ui/ErrorState";
import Skeleton from "@/components/ui/Skeleton";

export default function GroupDetailClient({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [group, setGroup] = useState<GroupSummary | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [quests, setQuests] = useState<GroupQuest[]>([]);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [questModalOpen, setQuestModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setMyUserId(data.user?.id ?? null));
  }, []);

  const load = useCallback(async () => {
    setError(false);
    try {
      const [listRes, membersRes, questsRes] = await Promise.all([
        fetch("/api/groups/list"),
        fetch(`/api/groups/members?groupId=${groupId}`),
        fetch(`/api/group-quests/list?groupId=${groupId}`),
      ]);
      if (!listRes.ok || !membersRes.ok || !questsRes.ok) throw new Error();
      const listBody = await listRes.json();
      const found = (listBody.groups as GroupSummary[]).find((g) => g.group_id === groupId);
      if (!found) throw new Error();
      setGroup(found);
      setMembers((await membersRes.json()).members ?? []);
      setQuests((await questsRes.json()).quests ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => { load(); }, [load]);

  async function changeRole(memberId: string, role: "admin" | "member") {
    const res = await fetch("/api/groups/members/role", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId, role }),
    });
    if (res.ok) load();
  }

  async function removeMember(memberId: string) {
    const res = await fetch("/api/groups/members/remove", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId }),
    });
    if (res.ok) load();
  }

  async function respondJoinRequest(memberId: string, action: "approve" | "decline") {
    const res = await fetch("/api/groups/join/respond", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId, action }),
    });
    if (res.ok) load();
  }

  async function handleDelete() {
    const res = await fetch("/api/groups/delete", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupId }),
    });
    if (res.ok) router.push("/groups");
  }

  async function handleLeave() {
    const myMembership = members.find((m) => m.status === "active" && m.user_id === myUserId);
    if (!myMembership) return;
    const res = await fetch("/api/groups/members/remove", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId: myMembership.member_id }),
    });
    if (res.ok) router.push("/groups");
  }

  if (loading) return <Skeleton className="h-64 rounded-2xl" />;
  if (error || !group) return <ErrorState type="server" onRetry={load} />;

  const canManage = group.my_role === "owner" || group.my_role === "admin";
  const isOwner = group.my_role === "owner";
  const activeMembers = members.filter((m) => m.status === "active");
  const pendingApprovals = canManage ? members.filter((m) => m.status === "pending_approval") : [];

  return (
    <div>
      <div className="card p-5 mb-5">
        <div className="flex items-start gap-3">
          <div className="w-14 h-14 rounded-xl bg-surface-elevated flex items-center justify-center text-3xl shrink-0" aria-hidden="true">{group.emoji}</div>
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-xl font-bold text-white">{group.name}</h1>
            {group.description && <p className="text-sm text-white/50 mt-1">{group.description}</p>}
            <div className="flex items-center gap-3 mt-2 text-xs text-white/40">
              <span>{activeMembers.length} members</span>
              <span className="flex items-center gap-1"><Trophy size={11} aria-hidden="true" /> {group.xp_total} XP</span>
            </div>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Group settings"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-white/40 hover:text-white/70 hover:bg-surface-elevated transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              <Settings size={18} />
            </button>
          )}
        </div>
      </div>

      {pendingApprovals.length > 0 && (
        <section className="mb-6" aria-labelledby="approvals-heading">
          <h2 id="approvals-heading" className="text-xs font-semibold uppercase tracking-wide text-white/40 mb-2">Join requests</h2>
          <div className="space-y-3">
            {pendingApprovals.map((m) => (
              <div key={m.member_id} className="card p-4 flex items-center gap-3">
                <p className="flex-1 min-w-0 text-sm text-white truncate">{m.display_name || "Saver"}</p>
                <button
                  type="button"
                  onClick={() => respondJoinRequest(m.member_id, "approve")}
                  aria-label={`Approve ${m.display_name || "this user"}'s request to join ${group.name}`}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                >
                  <Check size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => respondJoinRequest(m.member_id, "decline")}
                  aria-label={`Decline ${m.display_name || "this user"}'s request to join ${group.name}`}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-white/5 text-white/50 hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mb-6" aria-labelledby="quests-heading">
        <div className="flex items-center justify-between mb-2">
          <h2 id="quests-heading" className="text-xs font-semibold uppercase tracking-wide text-white/40">Group quests</h2>
          {canManage && (
            <button type="button" onClick={() => setQuestModalOpen(true)} className="text-xs text-brand-400 hover:text-brand-300 transition-colors">
              + New quest
            </button>
          )}
        </div>
        {quests.length === 0 ? (
          <p className="text-sm text-white/40 py-3">No group quests yet.</p>
        ) : (
          <div className="space-y-3">
            {quests.map((q) => <GroupQuestCard key={q.id} quest={q} canCheckCompletion onCompleted={load} />)}
          </div>
        )}
      </section>

      <section className="mb-6" aria-labelledby="members-heading">
        <div className="flex items-center justify-between mb-2">
          <h2 id="members-heading" className="text-xs font-semibold uppercase tracking-wide text-white/40">Members</h2>
          {canManage && (
            <button type="button" onClick={() => setInviteOpen(true)} className="text-xs text-brand-400 hover:text-brand-300 transition-colors flex items-center gap-1">
              <UserPlus size={12} /> Invite
            </button>
          )}
        </div>
        <div className="space-y-3">
          {activeMembers.map((m) => (
            <GroupMemberRow key={m.member_id} member={m} canManage={canManage} onChangeRole={changeRole} onRemove={removeMember} />
          ))}
        </div>
      </section>

      <div className="flex gap-3">
        {!isOwner ? (
          <button type="button" onClick={() => setLeaveOpen(true)} className="btn-ghost flex-1 text-sm text-red-400 flex items-center justify-center gap-1.5">
            <LogOut size={14} /> Leave group
          </button>
        ) : (
          <button type="button" onClick={() => setDeleteOpen(true)} className="btn-ghost flex-1 text-sm text-red-400 flex items-center justify-center gap-1.5">
            <Trash2 size={14} /> Delete group
          </button>
        )}
      </div>

      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title={`Invite someone to ${group.name}`}
        description="Search by username or name."
        excludeIds={members.map((m) => m.user_id)}
        onInvite={async (user) => {
          const res = await fetch("/api/groups/invite", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupId, targetUserId: user.id }),
          });
          const body = await res.json();
          if (!res.ok) throw new Error(body.error || "Couldn't send that invite");
          load();
        }}
        submitLabel="Send invite"
      />

      <CreateGroupQuestModal open={questModalOpen} onClose={() => setQuestModalOpen(false)} groupId={groupId} onCreated={load} />
      <GroupSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} group={group} onSaved={load} />

      <ConfirmationModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete this group?"
        description={`${group.name} and all its members, quests, and activity will be permanently deleted. This can't be undone.`}
        confirmLabel="Delete group"
        confirmAriaLabel={`Delete ${group.name}`}
      />
      <ConfirmationModal
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        onConfirm={handleLeave}
        title="Leave this group?"
        description={`You'll need a new invite to rejoin ${group.name}.`}
        confirmLabel="Leave group"
        confirmAriaLabel={`Leave ${group.name}`}
      />
    </div>
  );
}
