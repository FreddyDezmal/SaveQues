"use client";

/**
 * app/(app)/invites/InvitesClient.tsx
 *
 * Sprint 22, Phase 18. Consumes POST /api/invitations/create, GET
 * /api/invitations/list, POST /api/invitations/revoke exactly as
 * implemented. Invite URLs for past invites are rebuilt client-side as
 * `${origin}/invite/${token}` (matching lib/invites.ts's buildInviteUrl,
 * which is server-only — imports Node's `crypto` — so it isn't reused
 * here directly); /api/invitations/create's own response already
 * includes the freshly-built inviteUrl for the one just created.
 *
 * QR code: architecture-only per the brief ("QR Code (architecture only
 * if asset generation isn't available)") — no QR library exists in this
 * codebase's dependencies. The placeholder below is a labeled slot, not
 * a fake/broken QR image.
 */

import { useCallback, useEffect, useState } from "react";
import { Copy, Check, QrCode, X as XIcon } from "lucide-react";
import ShareButton from "@/components/sharing/ShareButton";
import StatusBadge, { type BadgeStatus } from "@/components/ui/StatusBadge";
import EmptyState from "@/components/ui/EmptyState";
import { formatDateNumeric } from "@/lib/dateFormat";
import ErrorState from "@/components/ui/ErrorState";
import Skeleton from "@/components/ui/Skeleton";
import ConfirmationModal from "@/components/ui/ConfirmationModal";

interface Invitation {
  id: string;
  invite_type: "email" | "link";
  email: string | null;
  token: string;
  context_type: "general" | "group";
  group_id: string | null;
  status: "pending" | "sent" | "opened" | "redeemed" | "revoked";
  redeemed_by: string | null;
  redeemed_at: string | null;
  expires_at: string;
  created_at: string;
}

function isExpired(inv: Invitation): boolean {
  return (inv.status === "pending" || inv.status === "sent" || inv.status === "opened") && new Date(inv.expires_at).getTime() < Date.now();
}

function displayStatus(inv: Invitation): BadgeStatus {
  if (isExpired(inv)) return "expired";
  return inv.status;
}

export default function InvitesClient() {
  const [invites, setInvites] = useState<Invitation[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<Invitation | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => { setOrigin(window.location.origin); }, []);

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch("/api/invitations/list");
      if (!res.ok) throw new Error();
      const body = await res.json();
      setInvites(body.invitations ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createLink() {
    setCreating(true);
    try {
      const res = await fetch("/api/invitations/create", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inviteType: "link" }),
      });
      const body = await res.json();
      if (res.ok) {
        setActiveUrl(body.inviteUrl);
        load();
      }
    } finally {
      setCreating(false);
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // no-op — matches ShareButton's silent-fail-if-unsupported pattern
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return;
    const res = await fetch("/api/invitations/revoke", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invitationId: revokeTarget.id }),
    });
    setRevokeTarget(null);
    if (res.ok) load();
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-16 rounded-2xl" />
      </div>
    );
  }
  if (error || invites === null) return <ErrorState type="server" onRetry={load} />;

  const unrevoked = invites.filter((i) => i.status !== "revoked");
  const redeemedCount = invites.filter((i) => i.status === "redeemed").length;

  return (
    <div>
      <section className="card p-5 mb-6">
        <h2 className="text-sm font-semibold text-white mb-1.5">Your referral link</h2>
        <p className="text-xs text-white/50 mb-4">
          Earn 100 XP for every friend who joins, plus 50 XP for them. Referral badges unlock at 1, 5, and 10 successful invites.
        </p>

        {activeUrl ? (
          <div>
            <div className="flex items-center gap-2 bg-surface-elevated rounded-xl p-3 mb-3">
              <p className="flex-1 min-w-0 text-xs text-white/70 truncate font-mono">{activeUrl}</p>
              <button
                type="button"
                onClick={() => copyLink(activeUrl)}
                aria-label="Copy invite link"
                className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg bg-white/5 text-white/60 hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 shrink-0"
              >
                {copied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
              </button>
            </div>
            <div className="flex items-center gap-3">
              <ShareButton
                title="Join me on SaveQuest"
                text="I'm using SaveQuest to save smarter — join me and we both earn XP!"
                url={activeUrl}
                shareContext="invite_link"
                className="flex-1"
              />
              <div className="w-11 h-11 rounded-xl bg-surface-elevated flex items-center justify-center text-white/20 shrink-0" title="QR code coming soon" aria-hidden="true">
                <QrCode size={18} />
              </div>
            </div>
          </div>
        ) : (
          <button type="button" onClick={createLink} disabled={creating} className="btn-primary w-full text-sm">
            {creating ? "Creating…" : "Create invite link"}
          </button>
        )}
      </section>

      <section aria-labelledby="history-heading">
        <div className="flex items-center justify-between mb-2">
          <h2 id="history-heading" className="text-xs font-semibold uppercase tracking-wide text-white/40">Invite history</h2>
          {redeemedCount > 0 && <span className="text-xs text-white/40">{redeemedCount} joined</span>}
        </div>

        {unrevoked.length === 0 ? (
          <EmptyState emoji="✉️" title="No invites sent yet" description="Create a link above and share it — you'll see who's joined here." />
        ) : (
          <div className="space-y-2.5">
            {unrevoked.map((inv) => {
              const url = `${origin}/invite/${inv.token}`;
              const canRevoke = inv.status !== "redeemed" && !isExpired(inv);
              return (
                <div key={inv.id} className="card p-3.5 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">
                      {inv.invite_type === "email" ? inv.email : "Share link"}
                      {inv.context_type === "group" && <span className="text-white/40"> · group invite</span>}
                    </p>
                    <p className="text-xs text-white/40 mt-0.5">
                      Sent {formatDateNumeric(inv.created_at)}
                    </p>
                  </div>
                  <StatusBadge status={displayStatus(inv)} />
                  {canRevoke && (
                    <button
                      type="button"
                      onClick={() => setRevokeTarget(inv)}
                      aria-label={`Revoke invite${inv.email ? ` to ${inv.email}` : ""}`}
                      className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 shrink-0"
                    >
                      <XIcon size={15} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <ConfirmationModal
        open={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onConfirm={handleRevoke}
        title="Revoke this invite?"
        description="This link will stop working. Anyone who already has it won't be able to join or claim the reward through it."
        confirmLabel="Revoke"
        confirmAriaLabel="Revoke this invite"
      />
    </div>
  );
}
