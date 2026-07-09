"use client";

/**
 * app/(app)/settings/notifications/NotificationPreferencesClient.tsx
 *
 * Sprint 16, Phase 1. Reads/writes app/api/notifications/preferences.
 * Optimistic toggle updates (flip immediately, revert on error) — same
 * pattern as NotificationCenter's mark-read from Sprint 15, kept consistent
 * rather than inventing a second convention for essentially the same
 * "toggle now, sync in background" interaction shape.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Trophy, Target, Flame, BarChart3, PartyPopper, Megaphone, AlertTriangle } from "lucide-react";
import Toggle from "@/components/ui/Toggle";
import Skeleton from "@/components/ui/Skeleton";

type Preferences = {
  achievements: boolean;
  goal_reminders: boolean;
  streak_reminders: boolean;
  weekly_summaries: boolean;
  milestone_celebrations: boolean;
  product_announcements: boolean;
};

const CATEGORY_META: {
  key: keyof Preferences;
  icon: React.ReactNode;
  title: string;
  description: string;
  /** Whether this category currently gates a real notification send — see
   *  the migration file for the full explanation of which four don't yet. */
  live: boolean;
}[] = [
  {
    key: "streak_reminders",
    icon: <Flame size={16} className="text-orange-400" />,
    title: "Daily streak reminders",
    description: "Nudges when your streak is about to break",
    live: true,
  },
  {
    key: "goal_reminders",
    icon: <Target size={16} className="text-brand-400" />,
    title: "Goal & quest reminders",
    description: "Daily quest, weekly quest, and challenge deadlines",
    live: true,
  },
  {
    key: "achievements",
    icon: <Trophy size={16} className="text-purple-400" />,
    title: "Achievement notifications",
    description: "When you unlock a new badge",
    live: true, // Sprint 17: wired to a real send (lib/awardXP.ts)
  },
  {
    key: "weekly_summaries",
    icon: <BarChart3 size={16} className="text-blue-400" />,
    title: "Weekly progress summaries",
    description: "A recap of your saving activity each week",
    live: true, // Sprint 17: wired to a real send (weekly cron, Mondays)
  },
  {
    key: "milestone_celebrations",
    icon: <PartyPopper size={16} className="text-emerald-400" />,
    title: "Saving milestone celebrations",
    description: "Big deposits, goal completions, and other wins",
    live: true, // Sprint 17: wired to a real send (goal completion only — see audit)
  },
  {
    key: "product_announcements",
    icon: <Megaphone size={16} className="text-white/50" />,
    title: "Product announcements",
    description: "New features and occasional SaveQuest news",
    live: false, // Still no sender — no content/CMS system exists for this yet
  },
];

export default function NotificationPreferencesClient() {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [error, setError] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/notifications/preferences")
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => setPrefs(data.preferences))
      .catch(() => setError(true));
  }, []);

  async function handleToggle(key: keyof Preferences, value: boolean) {
    if (!prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, [key]: value }); // optimistic
    setSavingKey(key);
    try {
      const res = await fetch("/api/notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setPrefs(previous); // revert on failure — never leave the UI claiming a save that didn't happen
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="p-4 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/settings" className="text-white/40 hover:text-white/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 rounded-lg p-1">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="font-display text-xl font-bold text-white">Notification Preferences</h1>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-red-500/10 border border-red-500/20 mb-4">
          <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-300/80">Couldn&apos;t load your preferences. Check your connection and reload.</p>
        </div>
      )}

      {!error && !prefs && (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      )}

      {prefs && (
        <div className="space-y-2">
          {CATEGORY_META.map(({ key, icon, title, description, live }) => (
            <div key={key} className="card p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center flex-shrink-0">
                  {icon}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">{title}</p>
                  <p className="text-xs text-white/40 mt-0.5">{description}</p>
                  {!live && (
                    <p className="text-[10px] text-white/25 mt-1">Coming soon — your preference is saved and will apply once this notification type ships.</p>
                  )}
                </div>
              </div>
              <Toggle
                checked={prefs[key]}
                onChange={(v) => handleToggle(key, v)}
                disabled={savingKey === key}
                label={title}
              />
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-white/30 mt-5">
        These control which types of notifications you receive. You can turn push notifications off entirely from the main Settings page.
      </p>
    </div>
  );
}
