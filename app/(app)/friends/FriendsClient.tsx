"use client";

/**
 * app/(app)/friends/FriendsClient.tsx
 *
 * Sprint 22. Consumes GET/POST /api/friends/* exactly as implemented —
 * no new client-side business logic, just fetch/render/mutate against
 * the existing routes. Optimistic-ish: after any mutation, refetches the
 * whole list (list_friends() is one cheap round trip, 046) rather than
 * hand-patching local state, avoiding a second source of truth for
 * something the server already computes correctly.
 */

import { useCallback, useEffect, useId, useState } from "react";
import { UserPlus } from "lucide-react";
import FriendCard, { type Friend } from "@/components/social/FriendCard";
import FriendRequestCard, { type PendingRequest } from "@/components/social/FriendRequestCard";
import InviteModal from "@/components/social/InviteModal";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import Skeleton from "@/components/ui/Skeleton";

type TabKey = "friends" | "incoming" | "outgoing";

interface FriendsData {
  friends: Friend[];
  pending_incoming: PendingRequest[];
  pending_outgoing: PendingRequest[];
}

export default function FriendsClient() {
  const [data, setData] = useState<FriendsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<TabKey>("friends");
  const [inviteOpen, setInviteOpen] = useState(false);
  const tablistId = useId();

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch("/api/friends/list");
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function respond(friendshipId: string, action: "accept" | "decline") {
    const res = await fetch("/api/friends/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ friendshipId, action }),
    });
    if (res.ok) load();
  }

  async function remove(friendshipId: string) {
    const res = await fetch("/api/friends/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ friendshipId }),
    });
    if (res.ok) load();
  }

  async function block(userId: string) {
    const res = await fetch("/api/friends/block", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId: userId }),
    });
    if (res.ok) load();
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
      </div>
    );
  }
  if (error || !data) return <ErrorState type="server" onRetry={load} />;

  const TABS: { key: TabKey; label: string; count: number }[] = [
    { key: "friends",  label: "Friends",  count: data.friends.length },
    { key: "incoming", label: "Requests", count: data.pending_incoming.length },
    { key: "outgoing", label: "Sent",     count: data.pending_outgoing.length },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div role="tablist" id={tablistId} aria-label="Friends sections" className="flex gap-1 bg-surface-elevated rounded-xl p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              id={`tab-${t.key}`}
              aria-selected={tab === t.key}
              aria-controls={`panel-${t.key}`}
              tabIndex={tab === t.key ? 0 : -1}
              onClick={() => setTab(t.key)}
              className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${
                tab === t.key ? "bg-brand-500 text-black" : "text-white/60 hover:text-white"
              }`}
            >
              {t.label}{t.count > 0 && ` (${t.count})`}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="btn-primary flex items-center gap-1.5 text-sm px-4 py-2.5"
        >
          <UserPlus size={16} /> Add
        </button>
      </div>

      <div role="tabpanel" id="panel-friends" aria-labelledby="tab-friends" hidden={tab !== "friends"}>
        {data.friends.length === 0 ? (
          <EmptyState emoji="🤝" title="No friends yet" description="Add friends to see their progress and cheer each other on." />
        ) : (
          <div className="space-y-3">
            {data.friends.map((f) => <FriendCard key={f.friendship_id} friend={f} onRemove={remove} onBlock={block} />)}
          </div>
        )}
      </div>

      <div role="tabpanel" id="panel-incoming" aria-labelledby="tab-incoming" hidden={tab !== "incoming"}>
        {data.pending_incoming.length === 0 ? (
          <EmptyState emoji="📭" title="No pending requests" description="Friend requests sent to you will show up here." />
        ) : (
          <div className="space-y-3">
            {data.pending_incoming.map((r) => (
              <FriendRequestCard
                key={r.friendship_id}
                request={r}
                direction="incoming"
                onAccept={(id) => respond(id, "accept")}
                onDecline={(id) => respond(id, "decline")}
              />
            ))}
          </div>
        )}
      </div>

      <div role="tabpanel" id="panel-outgoing" aria-labelledby="tab-outgoing" hidden={tab !== "outgoing"}>
        {data.pending_outgoing.length === 0 ? (
          <EmptyState emoji="📤" title="No sent requests" description="Requests you've sent will show up here until they're accepted." />
        ) : (
          <div className="space-y-3">
            {data.pending_outgoing.map((r) => (
              <FriendRequestCard key={r.friendship_id} request={r} direction="outgoing" onDecline={(id) => respond(id, "decline")} />
            ))}
          </div>
        )}
      </div>

      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Add a friend"
        description="Search by username or name."
        onInvite={async (user) => {
          const res = await fetch("/api/friends/request", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ targetUserId: user.id }),
          });
          const body = await res.json();
          if (!res.ok) throw new Error(body.error || "Couldn't send that request");
          load();
        }}
        submitLabel="Send request"
      />
    </div>
  );
}
