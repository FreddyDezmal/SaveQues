"use client";

/**
 * app/(app)/partner/PartnerClient.tsx
 *
 * Sprint 22. Consumes GET/POST /api/partner/* exactly as implemented.
 * saved_this_week (from get_partner_status, 047) is rendered as a
 * boolean pill ("Saved this week" / "Hasn't saved yet") — never an
 * amount, matching that RPC's own deliberate no-financial-data design.
 */

import { useCallback, useEffect, useState } from "react";
import { Flame, Bell, LogOut } from "lucide-react";
import UserAvatar, { UserName } from "@/components/social/UserAvatar";
import InviteModal from "@/components/social/InviteModal";
import ConfirmationModal from "@/components/ui/ConfirmationModal";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import Skeleton from "@/components/ui/Skeleton";
import StatusBadge from "@/components/ui/StatusBadge";

interface PartnerStatus {
  state: "none" | "pending_sent" | "pending_received" | "active";
  accountability_id?: string;
  partner_since?: string | null;
  partner?: {
    id: string; username: string | null; display_name: string | null; avatar_emoji: string | null;
    current_level: number; streak_days: number; longest_streak: number; saved_this_week: boolean | null;
  };
}

export default function PartnerClient() {
  const [data, setData] = useState<PartnerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const [nudgeSent, setNudgeSent] = useState(false);
  const [nudging, setNudging] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch("/api/partner");
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function respond(action: "accept" | "decline") {
    if (!data?.accountability_id) return;
    const res = await fetch("/api/partner/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountabilityId: data.accountability_id, action }),
    });
    if (res.ok) load();
  }

  async function handleEnd() {
    if (!data?.accountability_id) return;
    const res = await fetch("/api/partner/end", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountabilityId: data.accountability_id }),
    });
    setEndConfirmOpen(false);
    if (res.ok) load();
  }

  async function sendNudge() {
    setNudging(true);
    try {
      const res = await fetch("/api/partner/nudge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      if (res.ok) {
        setNudgeSent(true);
        setTimeout(() => setNudgeSent(false), 3000);
      }
    } finally {
      setNudging(false);
    }
  }

  if (loading) return <Skeleton className="h-40 rounded-2xl" />;
  if (error || !data) return <ErrorState type="server" onRetry={load} />;

  if (data.state === "none") {
    return (
      <>
        <EmptyState
          emoji="🤝"
          title="No accountability partner yet"
          description="Pair up with one friend to keep each other on track — weekly encouragement, milestone celebrations, shared streak motivation."
        />
        <button type="button" onClick={() => setInviteOpen(true)} className="btn-primary w-full mt-4 text-sm">
          Find a partner
        </button>
        <InviteModal
          open={inviteOpen}
          onClose={() => setInviteOpen(false)}
          title="Request an accountability partner"
          description="You can only have one partner at a time."
          onInvite={async (user) => {
            const res = await fetch("/api/partner/request", {
              method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetUserId: user.id }),
            });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error || "Couldn't send that request");
            load();
          }}
          submitLabel="Send request"
        />
      </>
    );
  }

  const p = data.partner!;
  const name = p.display_name || "Saver";

  if (data.state === "pending_sent") {
    return (
      <div className="card p-5 text-center">
        <UserAvatar emoji={p.avatar_emoji} size="lg" className="mx-auto mb-3" />
        <p className="text-sm text-white/70 mb-1">Request sent to <span className="font-medium text-white">{name}</span></p>
        <StatusBadge status="pending" className="mt-2" />
      </div>
    );
  }

  if (data.state === "pending_received") {
    return (
      <div className="card p-5 text-center">
        <UserAvatar emoji={p.avatar_emoji} size="lg" className="mx-auto mb-3" />
        <p className="text-sm text-white/70 mb-4"><span className="font-medium text-white">{name}</span> wants to be your accountability partner</p>
        <div className="flex gap-3 justify-center">
          <button type="button" onClick={() => respond("decline")} aria-label={`Decline ${name}'s partner request`} className="btn-ghost text-sm px-6">
            Decline
          </button>
          <button type="button" onClick={() => respond("accept")} aria-label={`Accept ${name}'s partner request`} className="btn-primary text-sm px-6">
            Accept
          </button>
        </div>
      </div>
    );
  }

  // active
  return (
    <div className="card p-5">
      <div className="flex items-center gap-3 mb-4">
        <UserAvatar emoji={p.avatar_emoji} size="lg" />
        <div className="flex-1 min-w-0">
          <UserName displayName={p.display_name} username={p.username} />
          <p className="text-xs text-white/40 mt-0.5">Level {p.current_level}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-surface-elevated rounded-xl p-3">
          <p className="text-xs text-white/40 mb-1 flex items-center gap-1"><Flame size={12} className="text-brand-400" aria-hidden="true" /> Streak</p>
          <p className="text-lg font-display font-semibold text-white">{p.streak_days} days</p>
        </div>
        <div className="bg-surface-elevated rounded-xl p-3">
          <p className="text-xs text-white/40 mb-1">This week</p>
          <p className="text-sm font-medium text-white">
            {p.saved_this_week ? "✅ Saved this week" : "Hasn't saved yet"}
          </p>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={sendNudge}
          disabled={nudging}
          className="btn-ghost flex-1 text-sm flex items-center justify-center gap-1.5"
          aria-label={`Send an encouragement nudge to ${name}`}
        >
          <Bell size={14} /> {nudgeSent ? "Nudge sent!" : "Nudge"}
        </button>
        <button
          type="button"
          onClick={() => setEndConfirmOpen(true)}
          className="btn-ghost text-sm px-4 flex items-center justify-center gap-1.5 text-red-400"
          aria-label={`End accountability partnership with ${name}`}
        >
          <LogOut size={14} />
        </button>
      </div>

      <ConfirmationModal
        open={endConfirmOpen}
        onClose={() => setEndConfirmOpen(false)}
        onConfirm={handleEnd}
        title="End this partnership?"
        description={`You and ${name} will no longer be accountability partners. Either of you can start a new one anytime.`}
        confirmLabel="End partnership"
        confirmAriaLabel={`End partnership with ${name}`}
      />
    </div>
  );
}
