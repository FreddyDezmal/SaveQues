"use client";

/**
 * components/notifications/NotificationCenter.tsx
 *
 * Slide-down panel listing recent notifications from notification_logs
 * (extended this sprint with read_at — see the migration and API routes).
 * Reuses notification_type values already produced by the existing
 * server-side notification cron jobs (see supabase/migrations/
 * 20260613_notifications_cron.sql) to pick an icon/label — no new
 * notification-generation logic was added; this is purely a read/display
 * + read-state layer on top of what already gets sent.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, CheckCheck, ChevronDown, Archive, Trash2 } from "lucide-react";
import { trackEvent, AnalyticsEvents } from "@/lib/analytics";
import { groupNotifications, type NotificationGroup } from "@/lib/notificationGrouping";
import { timeAgo } from "@/lib/utils";
import { useUndoSnackbar } from "@/components/ui/UndoSnackbar";
import EmptyState from "@/components/ui/EmptyState";
import { useHaptics } from "@/lib/hooks/useHaptics";
import { resolveNotificationHref, getNotificationActionLabel } from "@/lib/notificationActions";
import { getNotificationIcon } from "@/lib/notificationIcons";

interface NotificationRow {
  id: string;
  notification_type: string;
  title: string;
  body: string;
  sent_at: string;
  clicked_at: string | null;
  read_at: string | null;
  deep_link: string | null;
}

interface Props {
  onClose: () => void;
  onUnreadCountChange: (count: number) => void;
}



export default function NotificationCenter({ onClose, onUnreadCountChange }: Props) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationRow[] | null>(null);
  const [error, setError] = useState(false);
  // Sprint 27, Phase 12: separate from `notifications`/`error` above —
  // those mutate on every mark-read/archive/delete (already correctly
  // announced to screen readers via UndoSnackbar's role="status"), but
  // this component's INITIAL load transition (spinner → loaded list, or
  // → error message) had no screen-reader announcement at all. This
  // state exists only to drive that one announcement, once, rather than
  // re-firing on every later list mutation.
  const [loadStatus, setLoadStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const { showUndo } = useUndoSnackbar();
  const { vibrate } = useHaptics();
  // Sprint 16, Phase 3: pending server commits, keyed by a request id, so
  // Undo can cancel the actual API call rather than needing a separate
  // "mark unread" endpoint to reverse an already-persisted write. The UI
  // updates optimistically either way; only the SERVER write is delayed.
  const pendingCommits = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Sprint 17: closes an accessibility gap flagged as open in both the
  // Sprint 15 and Sprint 16 testing checklists — this modal previously had
  // no focus trap, no Escape-to-close, and didn't return focus to whatever
  // opened it. All three are standard WAI-ARIA dialog pattern requirements
  // for any modal, not specific to notifications.
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerElementRef = useRef<Element | null>(null);

  useEffect(() => {
    // Remember what had focus before the modal opened (almost certainly
    // the bell button in NotificationBell) so it can be restored on close
    // — without this, closing the modal would drop focus back to <body>,
    // stranding a keyboard user.
    triggerElementRef.current = document.activeElement;

    // Move focus into the panel itself on open, rather than leaving it on
    // whatever was focused before a mouse-triggered open (e.g. the bell
    // button, now hidden behind the overlay).
    panelRef.current?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      // Basic focus trap: cycle Tab/Shift+Tab between the first and last
      // focusable elements inside the panel, rather than letting focus
      // escape to the page behind the overlay.
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      // Return focus to whatever opened the modal, matching standard
      // WAI-ARIA dialog close behavior.
      if (triggerElementRef.current instanceof HTMLElement) {
        triggerElementRef.current.focus();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    trackEvent(AnalyticsEvents.NOTIFICATION_CENTER_OPENED);
    fetch("/api/notifications/list")
      .then((res) => {
        if (!res.ok) throw new Error("failed");
        return res.json();
      })
      .then((data) => {
        setNotifications(data.notifications ?? []);
        onUnreadCountChange(data.unreadCount ?? 0);
        setLoadStatus("loaded");
      })
      .catch(() => {
        setError(true);
        setLoadStatus("error");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const AUTO_DISMISS_MS = 5000; // must match UndoSnackbar's own window

  function commitMarkRead(body: object) {
    fetch("/api/notifications/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {
      // Non-fatal: worst case, read state re-syncs correctly next time the
      // panel opens and refetches from the server.
    });
  }

  /** Reverts the specific rows back to their pre-mark-read state. Used both
   *  by the "single row" and "group row" undo paths below. */
  function revertReadState(ids: string[], previousReadAt: Map<string, string | null>) {
    setNotifications((prev) =>
      prev ? prev.map((n) => (ids.includes(n.id) ? { ...n, read_at: previousReadAt.get(n.id) ?? null } : n)) : prev
    );
    const revertedUnreadCount = (notifications ?? []).filter(
      (n) => ids.includes(n.id) || !n.read_at
    ).length;
    onUnreadCountChange(revertedUnreadCount);
  }

  async function handleMarkAllRead() {
    if (!notifications) return;
    const previousReadAt = new Map(notifications.map((n) => [n.id, n.read_at]));
    const idsBeingMarked = notifications.filter((n) => !n.read_at).map((n) => n.id);
    if (idsBeingMarked.length === 0) return;

    const now = new Date().toISOString();
    setNotifications(notifications.map((n) => ({ ...n, read_at: n.read_at ?? now })));
    onUnreadCountChange(0);
    trackEvent(AnalyticsEvents.NOTIFICATION_MARK_ALL_READ);
    vibrate("light");

    const timeoutId = setTimeout(() => {
      commitMarkRead({ all: true });
      pendingCommits.current.delete("all");
    }, AUTO_DISMISS_MS);
    pendingCommits.current.set("all", timeoutId);

    showUndo(`Marked ${idsBeingMarked.length} notification${idsBeingMarked.length === 1 ? "" : "s"} as read`, () => {
      const t = pendingCommits.current.get("all");
      if (t) clearTimeout(t);
      pendingCommits.current.delete("all");
      revertReadState(idsBeingMarked, previousReadAt);
    });
  }

  async function handleMarkOneRead(id: string) {
    const target = notifications?.find((n) => n.id === id);
    if (!target || target.read_at) return; // already read — nothing to undo
    const previousReadAt = new Map([[id, target.read_at]]);

    setNotifications((prev) =>
      prev ? prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)) : prev
    );
    const unread = (notifications ?? []).filter((n) => n.id !== id && !n.read_at).length;
    onUnreadCountChange(unread);
    trackEvent(AnalyticsEvents.NOTIFICATION_MARKED_READ);
    vibrate("light");

    const timeoutId = setTimeout(() => {
      commitMarkRead({ id });
      pendingCommits.current.delete(id);
    }, AUTO_DISMISS_MS);
    pendingCommits.current.set(id, timeoutId);

    showUndo("Notification marked as read", () => {
      const t = pendingCommits.current.get(id);
      if (t) clearTimeout(t);
      pendingCommits.current.delete(id);
      revertReadState([id], previousReadAt);
    });
  }

  async function handleMarkGroupRead(ids: string[]) {
    if (ids.length === 0 || !notifications) return;
    const previousReadAt = new Map(notifications.filter((n) => ids.includes(n.id)).map((n) => [n.id, n.read_at]));
    const now = new Date().toISOString();

    setNotifications((prev) =>
      prev ? prev.map((n) => (ids.includes(n.id) ? { ...n, read_at: n.read_at ?? now } : n)) : prev
    );
    const unread = (notifications ?? []).filter((n) => !ids.includes(n.id) && !n.read_at).length;
    onUnreadCountChange(unread);
    trackEvent(AnalyticsEvents.NOTIFICATION_MARKED_READ, { grouped: true, count: ids.length });
    vibrate("light");

    const groupKey = ids.join(",");
    const timeoutId = setTimeout(() => {
      commitMarkRead({ ids });
      pendingCommits.current.delete(groupKey);
    }, AUTO_DISMISS_MS);
    pendingCommits.current.set(groupKey, timeoutId);

    showUndo(`Marked ${ids.length} notifications as read`, () => {
      const t = pendingCommits.current.get(groupKey);
      if (t) clearTimeout(t);
      pendingCommits.current.delete(groupKey);
      revertReadState(ids, previousReadAt);
    });
  }


  function commitArchive(id: string, archive: boolean) {
    fetch("/api/notifications/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, archive }),
    }).catch(() => {});
  }

  function commitDelete(id: string) {
    fetch("/api/notifications/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  }

  /** Archiving removes it from THIS list immediately (the panel only shows the active inbox, never archived) — unlike mark-read, there's no "leave it visible but styled differently" state, so undo has to restore the row's position, not just a field. */
  function handleArchive(id: string) {
    if (!notifications) return;
    const index = notifications.findIndex((n) => n.id === id);
    if (index === -1) return;
    const removed = notifications[index];

    setNotifications(notifications.filter((n) => n.id !== id));
    if (!removed.read_at) onUnreadCountChange(Math.max(0, (notifications.filter((n) => !n.read_at).length) - 1));
    trackEvent(AnalyticsEvents.NOTIFICATION_ARCHIVED);
    vibrate("light");

    const timeoutId = setTimeout(() => {
      commitArchive(id, true);
      pendingCommits.current.delete(`archive:${id}`);
    }, AUTO_DISMISS_MS);
    pendingCommits.current.set(`archive:${id}`, timeoutId);

    showUndo("Notification archived", () => {
      const t = pendingCommits.current.get(`archive:${id}`);
      if (t) clearTimeout(t);
      pendingCommits.current.delete(`archive:${id}`);
      setNotifications((prev) => {
        if (!prev) return prev;
        const next = [...prev];
        next.splice(index, 0, removed);
        return next;
      });
      if (!removed.read_at) onUnreadCountChange((notifications.filter((n) => !n.read_at).length));
    });
  }

  function handleDelete(id: string) {
    if (!notifications) return;
    const index = notifications.findIndex((n) => n.id === id);
    if (index === -1) return;
    const removed = notifications[index];

    setNotifications(notifications.filter((n) => n.id !== id));
    if (!removed.read_at) onUnreadCountChange(Math.max(0, (notifications.filter((n) => !n.read_at).length) - 1));
    trackEvent(AnalyticsEvents.NOTIFICATION_DELETED);
    vibrate("light");

    const timeoutId = setTimeout(() => {
      commitDelete(id);
      pendingCommits.current.delete(`delete:${id}`);
    }, AUTO_DISMISS_MS);
    pendingCommits.current.set(`delete:${id}`, timeoutId);

    showUndo("Notification deleted", () => {
      const t = pendingCommits.current.get(`delete:${id}`);
      if (t) clearTimeout(t);
      pendingCommits.current.delete(`delete:${id}`);
      setNotifications((prev) => {
        if (!prev) return prev;
        const next = [...prev];
        next.splice(index, 0, removed);
        return next;
      });
      if (!removed.read_at) onUnreadCountChange((notifications.filter((n) => !n.read_at).length));
    });
  }

  /** Sprint 27, Phase 2: notifications are now navigable, not just markable-read — marks read (existing behavior, unchanged) AND closes the panel while routing to the notification's real destination (deep_link, falling back to a category page — see lib/notificationActions.ts — never /dashboard by default). */
  function handleOpen(n: NotificationRow) {
    if (!n.read_at) handleMarkOneRead(n.id);
    trackEvent(AnalyticsEvents.NOTIFICATION_CLICKED, { type: n.notification_type });
    const href = resolveNotificationHref(n.notification_type as any, n.deep_link);
    onClose();
    router.push(href);
  }


  function toggleGroup(type: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  const groups: NotificationGroup<NotificationRow>[] = notifications ? groupNotifications(notifications) : [];

  const hasUnread = (notifications ?? []).some((n) => !n.read_at);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 bg-black/40" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
        tabIndex={-1}
        className="w-full max-w-sm rounded-2xl bg-surface-elevated border border-surface-border shadow-xl overflow-hidden outline-none animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border">
          <h2 className="text-sm font-semibold text-white">Notifications</h2>
          {/* Sprint 27, Phase 12: announces the load outcome once — see
              the loadStatus state comment above for why this is separate
              from the mark-read/archive/delete announcements, which
              already happen via UndoSnackbar's role="status". */}
          <div aria-live="polite" className="sr-only">
            {loadStatus === "loaded" && `${(notifications ?? []).length} notification${(notifications ?? []).length === 1 ? "" : "s"} loaded`}
            {loadStatus === "error" && "Couldn't load notifications"}
          </div>
          <div className="flex items-center gap-1">
            {hasUnread && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1 px-2 py-1 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
              >
                <CheckCheck size={13} /> Mark all read
              </button>
            )}
            <button
              onClick={onClose}
              className="text-white/40 hover:text-white/70 p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 rounded-lg"
              aria-label="Close notifications"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {error && (
            <p className="text-xs text-white/50 text-center py-8 px-4">
              Couldn&apos;t load notifications — check your connection and try again.
            </p>
          )}

          {!error && notifications === null && (
            <div className="py-8 flex justify-center">
              <div className="w-5 h-5 border-2 border-white/20 border-t-brand-500 rounded-full animate-spin" />
            </div>
          )}

          {!error && notifications !== null && notifications.length === 0 && (
            <EmptyState
              bare
              emoji="🔔"
              title="No notifications yet"
              description="Streak reminders, quest deadlines, and goal alerts will show up here."
            />
          )}

          {!error &&
            groups.map((g) => {
              if (g.kind === "single") {
                const n = g.notification;
                return (
                  <div
                    key={n.id}
                    className={`group relative w-full flex items-start gap-3 border-b border-surface-border last:border-b-0 transition-colors hover:bg-white/5 ${
                      !n.read_at ? "bg-brand-500/[0.04]" : ""
                    }`}
                  >
                    <button
                      onClick={() => handleOpen(n)}
                      className="flex-1 min-w-0 text-left px-4 py-3 flex items-start gap-3 focus-visible:outline-none focus-visible:bg-white/5"
                    >
                      <div className="mt-0.5 flex-shrink-0">{getNotificationIcon(n.notification_type)}</div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm ${!n.read_at ? "font-semibold text-white" : "text-white/70"}`}>{n.title}</p>
                        <p className="text-xs text-white/50 mt-0.5 line-clamp-2">{n.body}</p>
                        <p className="text-[11px] text-white/50 mt-1">{timeAgo(n.sent_at)}</p>
                      </div>
                      {!n.read_at && <span className="w-2 h-2 rounded-full bg-brand-400 flex-shrink-0 mt-1.5" aria-label="Unread" />}
                    </button>
                    {/* Sprint 27, Phase 2: archive/delete — opacity-0 by default so the
                        compact panel doesn't look cluttered; visible on hover/focus,
                        and always visible on touch (no hover state) via the group-focus
                        fallback below is intentionally skipped here — touch users can
                        still reach these via the full inbox page, which shows them
                        unconditionally. This panel stays a quick-glance surface. */}
                    <div className="flex-shrink-0 flex items-center gap-0.5 pr-2 pt-3 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleArchive(n.id)}
                        className="p-1.5 text-white/40 hover:text-white/70 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                        aria-label="Archive notification"
                      >
                        <Archive size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(n.id)}
                        className="p-1.5 text-white/40 hover:text-red-400 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                        aria-label="Delete notification"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              }

              // Grouped row — e.g. "3 new quest reminders"
              const isExpanded = expandedGroups.has(g.notification_type);
              const unreadIds = g.notifications.filter((n) => !n.read_at).map((n) => n.id);

              return (
                <div key={g.notification_type} className="border-b border-surface-border last:border-b-0">
                  <div
                    className={`w-full flex items-start gap-3 px-4 py-3 ${unreadIds.length > 0 ? "bg-brand-500/[0.04]" : ""}`}
                  >
                    <button
                      onClick={() => toggleGroup(g.notification_type)}
                      className="flex items-start gap-3 flex-1 min-w-0 text-left focus-visible:outline-none"
                      aria-expanded={isExpanded}
                    >
                      <div className="mt-0.5 flex-shrink-0">
                        {getNotificationIcon(g.notification_type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm ${unreadIds.length > 0 ? "font-semibold text-white" : "text-white/70"}`}>
                          {g.label}
                        </p>
                        <p className="text-[11px] text-white/50 mt-1">{timeAgo(g.notifications[0].sent_at)}</p>
                      </div>
                      <ChevronDown
                        size={15}
                        className={`text-white/40 flex-shrink-0 mt-0.5 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      />
                    </button>
                    {unreadIds.length > 0 && (
                      <button
                        onClick={() => handleMarkGroupRead(unreadIds)}
                        className="text-[11px] text-brand-400 hover:text-brand-300 flex-shrink-0 mt-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 rounded px-1"
                      >
                        Mark read
                      </button>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="bg-black/10">
                      {g.notifications.map((n) => (
                        <button
                          key={n.id}
                          onClick={() => handleMarkOneRead(n.id)}
                          className="w-full text-left pl-11 pr-4 py-2.5 flex items-start gap-3 border-t border-surface-border/50 hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:bg-white/5"
                        >
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs ${!n.read_at ? "font-medium text-white/90" : "text-white/50"}`}>{n.title}</p>
                            <p className="text-[11px] text-white/50 mt-0.5">{timeAgo(n.sent_at)}</p>
                          </div>
                          {!n.read_at && <span className="w-1.5 h-1.5 rounded-full bg-brand-400 flex-shrink-0 mt-1" aria-label="Unread" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
        </div>

        {!error && notifications !== null && notifications.length > 0 && (
          <div className="border-t border-surface-border px-4 py-2.5 text-center">
            <a
              href="/notifications"
              onClick={onClose}
              className="text-xs text-brand-400 hover:text-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 rounded px-1"
            >
              View all notifications
            </a>
          </div>
        )}
      </div>
    </div>
  );
}