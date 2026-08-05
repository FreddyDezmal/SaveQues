"use client";

/**
 * app/(app)/shared-goals/SharedGoalsClient.tsx
 *
 * Sprint 22. Consumes GET /api/shared-goals/list, POST /api/shared-goals/
 * invite/respond exactly as implemented.
 */

import { useCallback, useEffect, useState } from "react";
import { Plus, Check, X } from "lucide-react";
import SharedGoalCard, { type OwnedSharedGoal, type ContributingSharedGoal } from "@/components/social/SharedGoalCard";
import CreateSharedGoalModal from "@/components/social/CreateSharedGoalModal";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import Skeleton from "@/components/ui/Skeleton";

interface PendingInvite { member_id: string; shared_goal_id: string; goal_title: string; goal_emoji: string; owner_display_name: string; created_at: string; }
interface SharedGoalsData { owned: OwnedSharedGoal[]; contributing: ContributingSharedGoal[]; pending_invites: PendingInvite[]; }
interface EligibleGoal { id: string; title: string; goal_emoji: string; target_amount: number; current_amount: number; }

export default function SharedGoalsClient({ eligibleGoals, currencyCode, locale }: { eligibleGoals: EligibleGoal[]; currencyCode: string; locale: string }) {
  const [data, setData] = useState<SharedGoalsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch("/api/shared-goals/list");
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
    const res = await fetch("/api/shared-goals/invite/respond", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId, action }),
    });
    if (res.ok) load();
  }

  if (loading) return <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>;
  if (error || !data) return <ErrorState type="server" onRetry={load} />;

  const nothingAtAll = data.owned.length === 0 && data.contributing.length === 0 && data.pending_invites.length === 0;

  return (
    <div>
      <button type="button" onClick={() => setCreateOpen(true)} className="btn-primary w-full mb-5 flex items-center justify-center gap-1.5 text-sm">
        <Plus size={16} /> Share a goal
      </button>

      {data.pending_invites.length > 0 && (
        <section className="mb-6" aria-labelledby="sg-invites-heading">
          <h2 id="sg-invites-heading" className="text-xs font-semibold uppercase tracking-wide text-white/40 mb-2">Invitations</h2>
          <div className="space-y-3">
            {data.pending_invites.map((inv) => (
              <div key={inv.member_id} className="card p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-surface-elevated flex items-center justify-center text-xl shrink-0" aria-hidden="true">{inv.goal_emoji}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{inv.goal_title}</p>
                  <p className="text-xs text-white/40">from {inv.owner_display_name}</p>
                </div>
                <button
                  type="button"
                  onClick={() => respondInvite(inv.member_id, "accept")}
                  aria-label={`Accept invitation to contribute to ${inv.goal_title}`}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                >
                  <Check size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => respondInvite(inv.member_id, "decline")}
                  aria-label={`Decline invitation to contribute to ${inv.goal_title}`}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-white/5 text-white/50 hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.owned.length > 0 && (
        <section className="mb-6" aria-labelledby="sg-owned-heading">
          <h2 id="sg-owned-heading" className="text-xs font-semibold uppercase tracking-wide text-white/40 mb-2">Goals you&apos;re sharing</h2>
          <div className="space-y-3">
            {data.owned.map((g) => <SharedGoalCard key={g.shared_goal_id} goal={g} subtitle={`${g.contributor_count} contributor${g.contributor_count === 1 ? "" : "s"}`} />)}
          </div>
        </section>
      )}

      {data.contributing.length > 0 && (
        <section className="mb-6" aria-labelledby="sg-contributing-heading">
          <h2 id="sg-contributing-heading" className="text-xs font-semibold uppercase tracking-wide text-white/40 mb-2">Goals you&apos;re helping with</h2>
          <div className="space-y-3">
            {data.contributing.map((g) => <SharedGoalCard key={g.shared_goal_id} goal={g} subtitle={`${g.owner_display_name}'s goal`} />)}
          </div>
        </section>
      )}

      {nothingAtAll && (
        <EmptyState emoji="🎯" title="No shared goals yet" description="Share one of your goals to save together with friends or a group." />
      )}

      <CreateSharedGoalModal open={createOpen} onClose={() => setCreateOpen(false)} eligibleGoals={eligibleGoals} currencyCode={currencyCode} locale={locale} onCreated={load} />
    </div>
  );
}
