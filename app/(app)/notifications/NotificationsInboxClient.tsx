"use client";

/**
 * app/(app)/notifications/NotificationsInboxClient.tsx
 * ─────────────────────────────────────────────────────────────
 * Sprint 27 — Phase 2. The "full inbox" — bulk select, archive, delete,
 * and category filtering that the compact bell panel intentionally
 * doesn't try to fit (see that component's comment on why per-row
 * archive/delete there is hover-only and there's no bulk UI there).
 *
 * Reuses: GET /api/notifications/list (extended this sprint with
 * archived/category params), POST mark-read/archive/delete routes
 * (all pre-existing or added this sprint, none new to this file),
 * lib/notificationTaxonomy.ts + lib/notificationIcons.tsx +
 * lib/notificationActions.ts for category/icon/action-button logic —
 * this file has NO notification-domain logic of its own, purely
 * fetching + rendering + wiring clicks to the existing routes.
 */

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Archive, ArchiveRestore, Trash2, CheckCheck } from "lucide-react";
import { timeAgo } from "@/lib/utils";
import { trackEvent, AnalyticsEvents } from "@/lib/analytics";
import { useUndoSnackbar } from "@/components/ui/UndoSnackbar";
import EmptyState from "@/components/ui/EmptyState";
import { getNotificationIcon } from "@/lib/notificationIcons";
import { NOTIFICATION_CATEGORY_LABELS, NOTIFICATION_CATEGORY_ORDER, getNotificationTaxonomy, type NotificationCategory } from "@/lib/notificationTaxonomy";
import { resolveNotificationHref, getNotificationActionLabel } from "@/lib/notificationActions";

interface NotificationRow {
  id: string;
  notification_type: string;
  title: string;
  body: string;
  sent_at: string;
  clicked_at: string | null;
  read_at: string | null;
  deep_link: string | null;
  archived_at: string | null;
}

type Tab = "inbox" | "archived";

export default function NotificationsInboxClient() {
  const router = useRouter();
  const { showUndo } = useUndoSnackbar();
  const [tab, setTab] = useState<Tab>("inbox");
  const [category, setCategory] = useState<NotificationCategory | null>(null);
  const [notifications, setNotifications] = useState<NotificationRow[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    const params = new URLSearchParams({ limit: "50" });
    if (tab === "archived") params.set("archived", "true");
    if (category) params.set("category", category);

    fetch(`/api/notifications/list?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => setNotifications(data.notifications ?? []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [tab, category]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSelected(new Set()); }, [tab, category]); // clear selection on any filter change — a stale selection spanning tabs is confusing, not convenient

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!notifications) return;
    setSelected((prev) => (prev.size === notifications.length ? new Set() : new Set(notifications.map((n) => n.id))));
  }

  async function bulkAction(action: "read" | "archive" | "unarchive" | "delete", overrideIds?: string[]) {
    const ids = overrideIds ?? Array.from(selected);
    if (ids.length === 0) return;
    const count = ids.length;

    const endpoint = action === "delete" ? "/api/notifications/delete" : action === "read" ? "/api/notifications/mark-read" : "/api/notifications/archive";
    const body: Record<string, unknown> = { ids };
    if (action === "archive") body.archive = true;
    if (action === "unarchive") body.archive = false;

    // Optimistic — remove/update locally, then commit. Unlike the panel's
    // per-row undo (which delays the server write), actions here commit
    // immediately: a large optimistic-then-maybe-revert dance is more
    // failure-prone to get right than the value it'd add for an action
    // the user explicitly confirmed via a toolbar/icon tap (vs. a single
    // accidental swipe in the compact panel, which is what the delay/undo
    // pattern there is really protecting against).
    if (action === "delete" || action === "archive" || (action === "unarchive" && tab === "archived")) {
      setNotifications((prev) => prev?.filter((n) => !ids.includes(n.id)) ?? prev);
    } else if (action === "read") {
      setNotifications((prev) => prev?.map((n) => (ids.includes(n.id) ? { ...n, read_at: new Date().toISOString() } : n)) ?? prev);
    }
    setSelected(new Set());

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      if (action === "archive") trackEvent(AnalyticsEvents.NOTIFICATION_ARCHIVED, { bulk: count > 1, count });
      if (action === "delete") trackEvent(AnalyticsEvents.NOTIFICATION_DELETED, { bulk: count > 1, count });
    } catch {
      // Commit failed — re-fetch from the server rather than trying to
      // hand-reconstruct the exact prior local state for a whole batch.
      showUndo(`Couldn't update ${count} notification${count === 1 ? "" : "s"} — refreshing`, () => {});
      load();
    }
  }

  function handleOpen(n: NotificationRow) {
    if (!n.read_at) {
      setNotifications((prev) => prev?.map((row) => (row.id === n.id ? { ...row, read_at: new Date().toISOString() } : row)) ?? prev);
      fetch("/api/notifications/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: n.id }),
      }).catch(() => {});
    }
    trackEvent(AnalyticsEvents.NOTIFICATION_CLICKED, { type: n.notification_type, source: "inbox" });
    router.push(resolveNotificationHref(n.notification_type as any, n.deep_link));
  }

  const allSelected = notifications !== null && notifications.length > 0 && selected.size === notifications.length;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.back()} className="p-2 -ml-2 text-white/60 hover:text-white rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50" aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-xl font-bold text-white">Notifications</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-3 border-b border-surface-border" role="tablist">
        {(["inbox", "archived"] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? "border-brand-400 text-white" : "border-transparent text-white/50 hover:text-white/80"
            }`}
          >
            {t === "inbox" ? "Inbox" : "Archived"}
          </button>
        ))}
      </div>

      {/* Category filter chips */}
      <div className="flex flex-wrap gap-1.5 mb-4" role="group" aria-label="Filter by category">
        <button
          onClick={() => setCategory(null)}
          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
            category === null ? "bg-brand-500/15 border-brand-500/40 text-brand-300" : "border-white/10 text-white/50 hover:text-white/80"
          }`}
        >
          All
        </button>
        {NOTIFICATION_CATEGORY_ORDER.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              category === c ? "bg-brand-500/15 border-brand-500/40 text-brand-300" : "border-white/10 text-white/50 hover:text-white/80"
            }`}
          >
            {NOTIFICATION_CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      {/* Bulk toolbar — only shown once there's something to act on */}
      {notifications !== null && notifications.length > 0 && (
        <div className="flex items-center justify-between mb-2 px-1">
          <label className="flex items-center gap-2 text-xs text-white/50 cursor-pointer">
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="rounded border-white/20" />
            {selected.size > 0 ? `${selected.size} selected` : "Select all"}
          </label>
          {selected.size > 0 && (
            <div className="flex items-center gap-1">
              {tab === "inbox" && (
                <>
                  <button onClick={() => bulkAction("read")} className="p-1.5 text-white/50 hover:text-white rounded-lg" aria-label="Mark selected as read" title="Mark as read">
                    <CheckCheck size={16} />
                  </button>
                  <button onClick={() => bulkAction("archive")} className="p-1.5 text-white/50 hover:text-white rounded-lg" aria-label="Archive selected" title="Archive">
                    <Archive size={16} />
                  </button>
                </>
              )}
              {tab === "archived" && (
                <button onClick={() => bulkAction("unarchive")} className="p-1.5 text-white/50 hover:text-white rounded-lg" aria-label="Unarchive selected" title="Move to inbox">
                  <ArchiveRestore size={16} />
                </button>
              )}
              <button onClick={() => bulkAction("delete")} className="p-1.5 text-white/50 hover:text-red-400 rounded-lg" aria-label="Delete selected" title="Delete">
                <Trash2 size={16} />
              </button>
            </div>
          )}
        </div>
      )}

      <div className="card divide-y divide-surface-border overflow-hidden">
        {loading && (
          <div className="py-10 text-center text-sm text-white/40" role="status" aria-live="polite">Loading…</div>
        )}

        {!loading && error && (
          <div className="py-10 text-center text-sm text-white/40">Couldn&apos;t load notifications. <button onClick={load} className="text-brand-400 hover:underline">Try again</button></div>
        )}

        {!loading && !error && notifications !== null && notifications.length === 0 && (
          <EmptyState
            bare
            emoji={tab === "archived" ? "🗄️" : "🔔"}
            title={tab === "archived" ? "No archived notifications" : "You're all caught up"}
            description={tab === "archived" ? "Archive a notification and it'll show up here." : "Nothing new right now — check back later."}
          />
        )}

        {!loading && !error && notifications?.map((n) => {
          const actionLabel = getNotificationActionLabel(n.notification_type as any);
          return (
            <div key={n.id} className={`flex items-start gap-3 px-4 py-3 ${!n.read_at ? "bg-brand-500/[0.04]" : ""}`}>
              <input
                type="checkbox"
                checked={selected.has(n.id)}
                onChange={() => toggleSelected(n.id)}
                className="mt-1 rounded border-white/20 flex-shrink-0"
                aria-label={`Select notification: ${n.title}`}
              />
              <button onClick={() => handleOpen(n)} className="flex-1 min-w-0 text-left flex items-start gap-3 focus-visible:outline-none">
                <div className="mt-0.5 flex-shrink-0">{getNotificationIcon(n.notification_type)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`text-sm ${!n.read_at ? "font-semibold text-white" : "text-white/70"}`}>{n.title}</p>
                    {!n.read_at && <span className="w-1.5 h-1.5 rounded-full bg-brand-400 flex-shrink-0" aria-label="Unread" />}
                  </div>
                  <p className="text-xs text-white/40 mt-0.5">{n.body}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[11px] text-white/30">{timeAgo(n.sent_at)}</span>
                    <span className="text-[11px] text-white/20">·</span>
                    <span className="text-[11px] text-white/30">{NOTIFICATION_CATEGORY_LABELS[getNotificationTaxonomy(n.notification_type as any).category]}</span>
                  </div>
                </div>
              </button>
              <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
                {actionLabel && (
                  <button onClick={() => handleOpen(n)} className="text-xs text-brand-400 hover:text-brand-300 whitespace-nowrap">
                    {actionLabel}
                  </button>
                )}
                <div className="flex items-center gap-0.5">
                  {tab === "inbox" ? (
                    <button onClick={() => bulkAction("archive", [n.id])} className="p-1 text-white/30 hover:text-white/70 rounded" aria-label="Archive">
                      <Archive size={14} />
                    </button>
                  ) : (
                    <button onClick={() => bulkAction("unarchive", [n.id])} className="p-1 text-white/30 hover:text-white/70 rounded" aria-label="Move to inbox">
                      <ArchiveRestore size={14} />
                    </button>
                  )}
                  <button onClick={() => bulkAction("delete", [n.id])} className="p-1 text-white/30 hover:text-red-400 rounded" aria-label="Delete">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}