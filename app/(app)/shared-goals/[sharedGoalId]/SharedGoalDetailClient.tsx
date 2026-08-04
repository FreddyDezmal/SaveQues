"use client";

/**
 * app/(app)/shared-goals/[sharedGoalId]/SharedGoalDetailClient.tsx
 *
 * Sprint 22. Header/members data via GET /api/shared-goals/detail
 * (get_shared_goal_detail, 049). Contribution HISTORY (individual
 * line items, not just each member's total) has no dedicated API route
 * — group_contributions' own RLS (group_contributions_select_participant,
 * 045) already scopes direct reads to participants, so this queries it
 * directly client-side, the same reuse-existing-RLS pattern the shared-
 * goals list page uses for "my eligible goals." No new backend code.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Users, UserPlus, PlusCircle, Trash2, UserMinus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatPercent } from "@/lib/utils";
import UserAvatar, { UserName } from "@/components/social/UserAvatar";
import InviteModal from "@/components/social/InviteModal";
import ContributeModal from "@/components/social/ContributeModal";
import ContributionCard, { type Contribution } from "@/components/social/ContributionCard";
import StatusBadge, { type BadgeStatus } from "@/components/ui/StatusBadge";
import ConfirmationModal from "@/components/ui/ConfirmationModal";
import ErrorState from "@/components/ui/ErrorState";
import Skeleton from "@/components/ui/Skeleton";

interface Member {
  member_id: string; user_id: string; username: string | null; display_name: string | null;
  avatar_emoji: string | null; status: string; total_contributed: number;
}
interface Detail {
  shared_goal_id: string; goal_id: string; title: string; goal_emoji: string;
  target_amount: number; current_amount: number; is_complete: boolean;
  owner: { id: string; username: string | null; display_name: string | null; avatar_emoji: string | null; currency_code: string; locale: string };
  group: { id: string; name: string; emoji: string } | null;
  members: Member[];
  total_group_contributions: number;
  /** Sprint 31 — Phase 9. True only when at least one contribution was
   *  made in a different currency than the owner's — most shared goals
   *  today are single-currency, so this only shows a conversion note
   *  when it's actually relevant. */
  involves_currency_conversion: boolean;
}

export default function SharedGoalDetailClient({ sharedGoalId }: { sharedGoalId: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [contributeOpen, setContributeOpen] = useState(false);
  const [unshareOpen, setUnshareOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);

  const load = useCallback(async () => {
    setError(false);
    try {
      const supabase = createClient();
      const [{ data: { user } }, detailRes] = await Promise.all([
        supabase.auth.getUser(),
        fetch(`/api/shared-goals/detail?sharedGoalId=${sharedGoalId}`),
      ]);
      setMyUserId(user?.id ?? null);
      if (!detailRes.ok) throw new Error();
      const detailBody: Detail = await detailRes.json();
      setDetail(detailBody);

      const { data: rawContributions } = await supabase
        .from("group_contributions")
        .select("id, user_id, amount, currency_code, note, created_at")
        .eq("shared_goal_id", sharedGoalId)
        .order("created_at", { ascending: false })
        .limit(50);

      const nameByUserId = new Map(detailBody.members.map((m) => [m.user_id, m.display_name || "Saver"]));
      nameByUserId.set(detailBody.owner.id, detailBody.owner.display_name || "Saver");

      setContributions((rawContributions ?? []).map((c) => ({ ...c, contributor_name: nameByUserId.get(c.user_id) })));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [sharedGoalId]);

  useEffect(() => { load(); }, [load]);

  async function handleUnshare() {
    const res = await fetch("/api/shared-goals/unshare", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sharedGoalId }),
    });
    if (res.ok) router.push("/shared-goals");
  }

  async function handleRemoveMember() {
    if (!removeTarget) return;
    const res = await fetch("/api/shared-goals/members/remove", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId: removeTarget.member_id }),
    });
    setRemoveTarget(null);
    if (res.ok) load();
  }

  if (loading) return <Skeleton className="h-72 rounded-2xl" />;
  if (error || !detail) return <ErrorState type="server" onRetry={load} />;

  const isOwner = detail.owner.id === myUserId;
  const percent = detail.target_amount > 0 ? Math.min(100, (detail.current_amount / detail.target_amount) * 100) : 0;
  const activeMembers = detail.members.filter((m) => m.status === "active");

  return (
    <div>
      <div className="card p-5 mb-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-14 h-14 rounded-xl bg-surface-elevated flex items-center justify-center text-3xl shrink-0" aria-hidden="true">{detail.goal_emoji}</div>
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-xl font-bold text-white">{detail.title}</h1>
            <p className="text-xs text-white/40 mt-1">
              {isOwner ? "Your goal" : `${detail.owner.display_name || "Saver"}'s goal`}
              {detail.group && ` · shared with ${detail.group.name}`}
            </p>
          </div>
          {detail.is_complete && <StatusBadge status="completed" />}
        </div>

        <div
          className="h-2 rounded-full bg-surface-elevated overflow-hidden mb-1.5"
          role="progressbar"
          aria-valuenow={Math.round(percent)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Goal progress: ${formatPercent(percent)}`}
        >
          <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${percent}%` }} />
        </div>
        <p className="text-sm text-white/60">{formatCurrency(detail.current_amount, detail.owner.currency_code, detail.owner.locale)} of {formatCurrency(detail.target_amount, detail.owner.currency_code, detail.owner.locale)}</p>
        {detail.involves_currency_conversion && (
          <p className="text-xs text-white/30 mt-1">Converted to {detail.owner.currency_code} at today&apos;s rate — contributors&apos; own amounts are shown in their history below.</p>
        )}

        {!isOwner && activeMembers.some((m) => m.user_id === myUserId) && (
          <button type="button" onClick={() => setContributeOpen(true)} className="btn-primary w-full mt-4 flex items-center justify-center gap-1.5 text-sm">
            <PlusCircle size={16} /> Log a contribution
          </button>
        )}
      </div>

      <section className="mb-6" aria-labelledby="sg-members-heading">
        <div className="flex items-center justify-between mb-2">
          <h2 id="sg-members-heading" className="text-xs font-semibold uppercase tracking-wide text-white/40 flex items-center gap-1">
            <Users size={12} aria-hidden="true" /> Contributors
          </h2>
          {isOwner && (
            <button type="button" onClick={() => setInviteOpen(true)} className="text-xs text-brand-400 hover:text-brand-300 transition-colors flex items-center gap-1">
              <UserPlus size={12} /> Invite
            </button>
          )}
        </div>
        <div className="space-y-3">
          <div className="card p-4 flex items-center gap-3">
            <UserAvatar emoji={detail.owner.avatar_emoji} />
            <UserName displayName={detail.owner.display_name} username={detail.owner.username} className="flex-1 min-w-0" />
            <span className="text-xs text-white/40">Owner</span>
          </div>
          {activeMembers.map((m) => (
            <div key={m.member_id} className="card p-4 flex items-center gap-3">
              <UserAvatar emoji={m.avatar_emoji} />
              <UserName displayName={m.display_name} username={m.username} className="flex-1 min-w-0" />
              <span className="text-xs text-white/50">{formatCurrency(m.total_contributed, detail.owner.currency_code, detail.owner.locale)}</span>
              {isOwner && (
                <button
                  type="button"
                  onClick={() => setRemoveTarget(m)}
                  aria-label={`Remove ${m.display_name || "this contributor"} from ${detail.title}`}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-white/30 hover:text-red-400 hover:bg-surface-elevated transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 -m-1.5"
                >
                  <UserMinus size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="mb-6" aria-labelledby="sg-history-heading">
        <h2 id="sg-history-heading" className="text-xs font-semibold uppercase tracking-wide text-white/40 mb-2">Contribution history</h2>
        {contributions.length === 0 ? (
          <p className="text-sm text-white/40 py-3">No contributions logged yet.</p>
        ) : (
          <div className="card p-4">
            {contributions.map((c) => <ContributionCard key={c.id} contribution={c} />)}
          </div>
        )}
      </section>

      {isOwner && (
        <button type="button" onClick={() => setUnshareOpen(true)} className="btn-ghost w-full text-sm text-red-400 flex items-center justify-center gap-1.5">
          <Trash2 size={14} /> Stop sharing this goal
        </button>
      )}

      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title={`Invite someone to help with ${detail.title}`}
        description="Search by username or name."
        excludeIds={[detail.owner.id, ...detail.members.map((m) => m.user_id)]}
        onInvite={async (user) => {
          const res = await fetch("/api/shared-goals/invite", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sharedGoalId, targetUserId: user.id }),
          });
          const body = await res.json();
          if (!res.ok) throw new Error(body.error || "Couldn't send that invite");
          load();
        }}
        submitLabel="Send invite"
      />

      <ContributeModal open={contributeOpen} onClose={() => setContributeOpen(false)} sharedGoalId={sharedGoalId} goalTitle={detail.title} onContributed={load} />

      <ConfirmationModal
        open={unshareOpen}
        onClose={() => setUnshareOpen(false)}
        onConfirm={handleUnshare}
        title="Stop sharing this goal?"
        description="Contributors will lose access and the contribution history will be deleted. Your goal itself and its real balance are unaffected."
        confirmLabel="Stop sharing"
        confirmAriaLabel={`Stop sharing ${detail.title}`}
      />

      <ConfirmationModal
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={handleRemoveMember}
        title="Remove this contributor?"
        description={`${removeTarget?.display_name || "This person"} will lose access to ${detail.title}.`}
        confirmLabel="Remove"
        confirmAriaLabel={`Remove ${removeTarget?.display_name || "this contributor"}`}
      />
    </div>
  );
}
