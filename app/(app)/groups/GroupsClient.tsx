"use client";

/**
 * app/(app)/groups/GroupsClient.tsx
 *
 * Sprint 22. Consumes GET /api/groups/list, POST /api/groups/invite/
 * respond, POST /api/groups/join/respond exactly as implemented.
 */

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import GroupCard, { type GroupSummary } from "@/components/social/GroupCard";
import CreateGroupModal from "@/components/social/CreateGroupModal";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import Skeleton from "@/components/ui/Skeleton";
import { Check, X } from "lucide-react";

interface PendingInvite { member_id: string; group_id: string; name: string; emoji: string; invited_by: string | null; created_at: string; }
interface PendingRequest { member_id: string; group_id: string; name: string; emoji: string; created_at: string; }
interface GroupsData { groups: GroupSummary[]; pending_invites: PendingInvite[]; pending_join_requests: PendingRequest[]; }

export default function GroupsClient() {
  const [data, setData] = useState<GroupsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch("/api/groups/list");
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function respondInvite(memberId: string, action: "accept" | "decline") {
    const res = await fetch("/api/groups/invite/respond", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId, action }),
    });
    if (res.ok) load();
  }

  if (loading) {
    return <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>;
  }
  if (error || !data) return <ErrorState type="server" onRetry={load} />;

  return (
    <div>
      <button type="button" onClick={() => setCreateOpen(true)} className="btn-primary w-full mb-5 flex items-center justify-center gap-1.5 text-sm">
        <Plus size={16} /> Create a group
      </button>

      {data.pending_invites.length > 0 && (
        <section className="mb-6" aria-labelledby="invites-heading">
          <h2 id="invites-heading" className="text-xs font-semibold uppercase tracking-wide text-white/40 mb-2">Invitations</h2>
          <div className="space-y-3">
            {data.pending_invites.map((inv) => (
              <div key={inv.member_id} className="card p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-surface-elevated flex items-center justify-center text-xl shrink-0" aria-hidden="true">{inv.emoji}</div>
                <p className="flex-1 min-w-0 text-sm text-white truncate">{inv.name}</p>
                <button
                  type="button"
                  onClick={() => respondInvite(inv.member_id, "accept")}
                  aria-label={`Accept invitation to join ${inv.name}`}
                  className="p-2 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                >
                  <Check size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => respondInvite(inv.member_id, "decline")}
                  aria-label={`Decline invitation to join ${inv.name}`}
                  className="p-2 rounded-lg bg-white/5 text-white/50 hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.pending_join_requests.length > 0 && (
        <section className="mb-6" aria-labelledby="requests-heading">
          <h2 id="requests-heading" className="text-xs font-semibold uppercase tracking-wide text-white/40 mb-2">Your join requests</h2>
          <div className="space-y-3">
            {data.pending_join_requests.map((r) => (
              <div key={r.member_id} className="card p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-surface-elevated flex items-center justify-center text-xl shrink-0" aria-hidden="true">{r.emoji}</div>
                <p className="flex-1 min-w-0 text-sm text-white truncate">{r.name}</p>
                <span className="text-xs text-white/40">Awaiting approval</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="my-groups-heading">
        <h2 id="my-groups-heading" className="text-xs font-semibold uppercase tracking-wide text-white/40 mb-2">My groups</h2>
        {data.groups.length === 0 ? (
          <EmptyState emoji="👥" title="No groups yet" description="Create a group to save together with family, friends, or roommates." />
        ) : (
          <div className="space-y-3">
            {data.groups.map((g) => <GroupCard key={g.group_id} group={g} />)}
          </div>
        )}
      </section>

      <CreateGroupModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={load} />
    </div>
  );
}
