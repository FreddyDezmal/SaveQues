"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import NotificationCenter from "@/components/notifications/NotificationCenter";
import { useAppBadge } from "@/lib/hooks/useAppBadge";

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState<number | null>(null);

  // Phase 6: App Badge API. Kept as a one-line integration here rather than
  // its own always-mounted component, since the unread count already has
  // to live somewhere client-side to render the little dot on the bell —
  // reusing that same piece of state for the OS-level badge avoids a
  // second, separate fetch of the same data.
  useAppBadge(unreadCount);

  useEffect(() => {
    // Lightweight initial count fetch so the badge dot can show up without
    // requiring the user to open the panel first. The panel's own fetch
    // (in NotificationCenter) re-confirms this when opened.
    fetch("/api/notifications/list?limit=30")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setUnreadCount(data.unreadCount ?? 0);
      })
      .catch(() => {});
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative p-2 text-white/70 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 rounded-lg"
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
      >
        <Bell size={20} />
        {!!unreadCount && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-brand-500 text-black text-[10px] font-bold flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <NotificationCenter
          onClose={() => setOpen(false)}
          onUnreadCountChange={setUnreadCount}
        />
      )}
    </>
  );
}
