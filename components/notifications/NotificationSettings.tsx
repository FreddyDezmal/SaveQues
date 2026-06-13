"use client";

import { useState } from "react";
import { Bell, BellOff, BellRing, Loader2, CheckCircle, AlertTriangle, ExternalLink } from "lucide-react";
import { useNotifications } from "@/lib/hooks/useNotifications";
import { createClient } from "@/lib/supabase/client";

interface Props {
  profileId:            string;
  currentHour:          number | null;
  notificationsEnabled: boolean;
}

const HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: i === 0 ? "12:00 AM" : i < 12 ? `${i}:00 AM` : i === 12 ? "12:00 PM" : `${i - 12}:00 PM`,
}));

const ERROR_MESSAGES: Record<string, { title: string; help: string; showBrowserTip?: boolean }> = {
  permission_denied: {
    title: "Notifications are blocked",
    help: "Click the lock icon (🔒) in your browser's address bar → Notifications → Allow, then reload the page.",
    showBrowserTip: true,
  },
  unsupported: {
    title: "Not supported in this browser",
    help: "Push notifications require Chrome, Firefox, Edge, or Safari 16.4+. Private/Incognito mode also blocks them.",
  },
  sw_failed: {
    title: "Service worker failed to load",
    help: "Make sure /sw.js is deployed and your app is served over HTTPS (localhost is fine for dev). Check the browser console for details.",
  },
  push_subscribe_failed: {
    title: "Push subscription failed",
    help: "This can happen if NEXT_PUBLIC_VAPID_PUBLIC_KEY is wrong, or if the browser blocked the subscription. Check the console for the full error.",
  },
  server_failed: {
    title: "Could not save subscription",
    help: "The subscription was created in your browser but couldn't be saved to the server. Check that the /api/notifications/subscribe route is deployed.",
  },
  vapid_missing: {
    title: "VAPID key not configured",
    help: "NEXT_PUBLIC_VAPID_PUBLIC_KEY is missing from your environment variables. Add it to .env.local and restart the dev server.",
  },
};

export default function NotificationSettings({ profileId, currentHour, notificationsEnabled }: Props) {
  const { permission, isSubscribed, isLoading, error, errorDetail, subscribe, unsubscribe } = useNotifications();
  const [notifHour, setNotifHour] = useState(currentHour ?? 20);
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleToggle() {
    if (isSubscribed) {
      await unsubscribe();
    } else {
      await subscribe();
    }
  }

  async function handleSaveHour() {
    setSaving(true);
    setSaveError(null);
    try {
      const supabase = createClient();
      const { error: e } = await supabase
        .from("profiles")
        .update({ last_notification_hour: notifHour })
        .eq("id", profileId);
      if (e) throw e;
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setSaveError(e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const errorInfo = error ? ERROR_MESSAGES[error] : null;

  const StatusIcon = isSubscribed
    ? BellRing
    : permission === "denied"
    ? BellOff
    : Bell;

  const statusColor = isSubscribed
    ? "text-emerald-400"
    : permission === "denied"
    ? "text-red-400"
    : "text-white/40";

  const statusLabel = isSubscribed
    ? "Reminders are active"
    : permission === "denied"
    ? "Blocked in browser settings"
    : permission === "unsupported"
    ? "Not supported in this browser"
    : "Tap to enable";

  return (
    <div className="mb-6">
      <p className="text-xs text-white/40 uppercase tracking-wider font-medium mb-3">Notifications</p>

      <div className="card p-4 space-y-5">

        {/* Toggle row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <StatusIcon size={16} className={`shrink-0 ${statusColor}`} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-white">Push notifications</p>
              <p className="text-xs text-white/40 mt-0.5">{statusLabel}</p>
            </div>
          </div>

          <button
            onClick={handleToggle}
            disabled={isLoading || permission === "denied" || permission === "unsupported"}
            className={`relative shrink-0 w-12 h-6 rounded-full transition-colors focus:outline-none disabled:opacity-40 ml-3 ${
              isSubscribed ? "bg-brand-500" : "bg-surface-border"
            }`}
            aria-label={isSubscribed ? "Disable notifications" : "Enable notifications"}
          >
            {isLoading ? (
              <Loader2 size={12} className="absolute inset-0 m-auto animate-spin text-white" />
            ) : (
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${
                  isSubscribed ? "translate-x-6" : "translate-x-0"
                }`}
              />
            )}
          </button>
        </div>

        {/* Error display */}
        {errorInfo && (
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
            <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-red-400">{errorInfo.title}</p>
              <p className="text-xs text-red-300/70 mt-0.5">{errorInfo.help}</p>
              {errorDetail && (
                <p className="text-[10px] text-red-300/50 mt-1.5 font-mono break-all">{errorDetail}</p>
              )}
            </div>
          </div>
        )}

        {/* Reminder hour — only when subscribed */}
        {isSubscribed && (
          <div>
            <label className="block text-sm text-white/60 mb-1.5">Daily reminder time</label>
            <div className="flex gap-2 items-center">
              <select
                className="input-field flex-1"
                value={notifHour}
                onChange={(e) => setNotifHour(Number(e.target.value))}
              >
                {HOURS.map((h) => (
                  <option key={h.value} value={h.value}>{h.label}</option>
                ))}
              </select>
              <button
                onClick={handleSaveHour}
                disabled={saving}
                className="btn-primary px-4 py-2.5 text-sm whitespace-nowrap flex items-center gap-1.5 shrink-0"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                {saved  ? <><CheckCircle size={14} /> Saved</> : "Save time"}
              </button>
            </div>
            {saveError && <p className="text-xs text-red-400 mt-1.5">{saveError}</p>}
            <p className="text-xs text-white/30 mt-1.5">
              Reminders are sent in your local timezone at this hour each day.
            </p>
          </div>
        )}

        {/* What you'll be notified about */}
        {isSubscribed && (
          <div>
            <p className="text-xs text-white/40 mb-2">You&apos;ll be reminded when:</p>
            <ul className="space-y-1.5 text-xs text-white/50">
              <li className="flex items-center gap-2"><span>🔥</span> Your streak is at risk of breaking</li>
              <li className="flex items-center gap-2"><span>📋</span> You haven&apos;t completed today&apos;s quest</li>
              <li className="flex items-center gap-2"><span>⏰</span> A weekly quest is expiring soon</li>
              <li className="flex items-center gap-2"><span>⚡</span> A seasonal challenge is ending soon</li>
              <li className="flex items-center gap-2"><span>👋</span> You&apos;ve been inactive for 3+ days</li>
            </ul>
          </div>
        )}

        {/* Permission denied recovery instructions */}
        {permission === "denied" && (
          <div className="p-3 rounded-xl bg-surface-border/50 space-y-1">
            <p className="text-xs text-white/50 font-medium">How to unblock:</p>
            <p className="text-xs text-white/30">
              Chrome/Edge: click the 🔒 in the address bar → Site settings → Notifications → Allow
            </p>
            <p className="text-xs text-white/30">
              Firefox: click the 🔒 → More information → Permissions → Send notifications → Allow
            </p>
            <p className="text-xs text-white/30">
              Safari: Settings → Websites → Notifications → find this site → Allow
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
