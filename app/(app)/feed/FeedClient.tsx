"use client";

/**
 * app/(app)/feed/FeedClient.tsx
 *
 * Sprint 22. Consumes GET /api/feed (cursor-paginated via `before`,
 * capped at 50 per page — 051/052) and POST /api/feed/hide exactly as
 * implemented. A "Load more" button rather than scroll-triggered
 * infinite loading — more reliably keyboard/screen-reader operable than
 * an IntersectionObserver pattern, and this backend has no Realtime
 * (confirmed in PERFORMANCE_AUDIT.md), so there's no "new post arrived
 * while you were reading" case to handle with aria-live; the live region
 * below announces newly loaded pages instead, which is the honest
 * equivalent of what this backend can actually do.
 */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import ActivityFeedCard, { type FeedItem } from "@/components/social/ActivityFeedCard";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import Skeleton from "@/components/ui/Skeleton";

export default function FeedClient() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [liveMessage, setLiveMessage] = useState("");

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setMyUserId(data.user?.id ?? null));
  }, []);

  const loadFirstPage = useCallback(async () => {
    setError(false);
    setLoading(true);
    try {
      const res = await fetch("/api/feed?limit=30");
      if (!res.ok) throw new Error();
      const body = await res.json();
      setItems(body.items ?? []);
      setHasMore((body.items ?? []).length === 30);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadFirstPage(); }, [loadFirstPage]);

  async function loadMore() {
    if (items.length === 0) return;
    setLoadingMore(true);
    try {
      const before = items[items.length - 1].created_at;
      const res = await fetch(`/api/feed?limit=30&before=${encodeURIComponent(before)}`);
      if (!res.ok) throw new Error();
      const body = await res.json();
      const newItems: FeedItem[] = body.items ?? [];
      setItems((prev) => [...prev, ...newItems]);
      setHasMore(newItems.length === 30);
      setLiveMessage(`Loaded ${newItems.length} more post${newItems.length === 1 ? "" : "s"}`);
    } finally {
      setLoadingMore(false);
    }
  }

  async function hide(id: string) {
    const res = await fetch("/api/feed/hide", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feedItemId: id }),
    });
    if (res.ok) setItems((prev) => prev.filter((i) => i.id !== id));
  }

  if (loading) return <div className="space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>;
  if (error) return <ErrorState type="server" onRetry={loadFirstPage} />;
  if (items.length === 0) {
    return <EmptyState emoji="📰" title="No activity yet" description="Achievements, goal completions, and group milestones from you and your friends will show up here." />;
  }

  return (
    <div>
      <div aria-live="polite" className="sr-only">{liveMessage}</div>
      <div className="space-y-3">
        {items.map((item) => (
          <ActivityFeedCard key={item.id} item={item} isOwn={item.actor_id === myUserId} onHide={hide} />
        ))}
      </div>
      {hasMore && (
        <button type="button" onClick={loadMore} disabled={loadingMore} className="btn-ghost w-full mt-4 text-sm">
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
