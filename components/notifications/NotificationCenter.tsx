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

import { useEffect, useState } from "react";
import { X, Flame, Target, Trophy, Clock, Bell, CheckCheck } from "lucide-react";
import { trackEvent, AnalyticsEvents } from "@/lib/analytics";

interface NotificationRow {
  id: string;
  notification_type: string;
  title: string;
  body: string;
  sent_at: string;
  clicked_at: string | null;
  read_at: string | null;
}

interface Props {
  onClose: () => void;
  onUnreadCountChange: (count: number) => void;
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  streak_at_risk: <Flame size={16} className="text-orange-400" />,
  daily_quest: <Target size={16} className="text-brand-400" />,
  weekly_expiry: <Clock size={16} className="text-amber-400" />,
  seasonal_expiry: <Trophy size={16} className="text-purple-400" />,
  inactive: <Bell size={16} className="text-white/40" />,
};

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function NotificationCenter({ onClose, onUnreadCountChange }: Props) {
  const [notifications, setNotifications] = useState<NotificationRow[] | null>(null);
  const [error, setError] = useState(false);

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
      })
      .catch(() => setError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleMarkAllRead() {
    if (!notifications) return;
    const now = new Date().toISOString();
    setNotifications(notifications.map((n) => ({ ...n, read_at: n.read_at ?? now })));
    onUnreadCountChange(0);
    trackEvent(AnalyticsEvents.NOTIFICATION_MARK_ALL_READ);
    try {
      await fetch("/api/notifications/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
    } catch {
      // Non-fatal: worst case, read state re-syncs correctly next time the
      // panel opens and refetches from the server, which is the source of
      // truth — the optimistic UI update above doesn't need to be undone.
    }
  }

  async function handleMarkOneRead(id: string) {
    setNotifications((prev) =>
      prev ? prev.map((n) => (n.id === id ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)) : prev
    );
    const unread = (notifications ?? []).filter((n) => n.id !== id && !n.read_at).length;
    onUnreadCountChange(unread);
    trackEvent(AnalyticsEvents.NOTIFICATION_MARKED_READ);
    try {
      await fetch("/api/notifications/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch {}
  }

  const hasUnread = (notifications ?? []).some((n) => !n.read_at);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl bg-surface-elevated border border-surface-border shadow-xl overflow-hidden animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border">
          <h2 className="text-sm font-semibold text-white">Notifications</h2>
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
              className="text-white/40 hover:text-white/70 p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 rounded-lg"
              aria-label="Close notifications"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {error && (
            <p className="text-xs text-white/40 text-center py-8 px-4">
              Couldn't load notifications — check your connection and try again.
            </p>
          )}

          {!error && notifications === null && (
            <div className="py-8 flex justify-center">
              <div className="w-5 h-5 border-2 border-white/20 border-t-brand-500 rounded-full animate-spin" />
            </div>
          )}

          {!error && notifications !== null && notifications.length === 0 && (
            <p className="text-xs text-white/40 text-center py-8 px-4">
              No notifications yet — streak reminders and goal alerts will show up here.
            </p>
          )}

          {!error &&
            notifications?.map((n) => (
              <button
                key={n.id}
                onClick={() => handleMarkOneRead(n.id)}
                className={`w-full text-left px-4 py-3 flex items-start gap-3 border-b border-surface-border last:border-b-0 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:bg-white/5 ${
                  !n.read_at ? "bg-brand-500/[0.04]" : ""
                }`}
              >
                <div className="mt-0.5 flex-shrink-0">{TYPE_ICON[n.notification_type] ?? <Bell size={16} className="text-white/40" />}</div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${!n.read_at ? "font-semibold text-white" : "text-white/70"}`}>{n.title}</p>
                  <p className="text-xs text-white/40 mt-0.5 line-clamp-2">{n.body}</p>
                  <p className="text-[11px] text-white/30 mt-1">{timeAgo(n.sent_at)}</p>
                </div>
                {!n.read_at && <span className="w-2 h-2 rounded-full bg-brand-400 flex-shrink-0 mt-1.5" aria-label="Unread" />}
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
