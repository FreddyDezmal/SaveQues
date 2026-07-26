"use client";

/**
 * app/(app)/settings/notifications/NotificationPreferencesClient.tsx
 *
 * Sprint 16, Phase 1. Reads/writes app/api/notifications/preferences.
 * Optimistic toggle updates (flip immediately, revert on error) — same
 * pattern as NotificationCenter's mark-read from Sprint 15, kept consistent
 * rather than inventing a second convention for essentially the same
 * "toggle now, sync in background" interaction shape.
 *
 * Sprint 27, Phase 4: expanded from six categories to eleven, plus three
 * new sections below the category list — quiet hours, vacation mode,
 * digest frequency. See the migration's honesty note
 * (20260723_notification_preferences_expansion.sql) for exactly which of
 * the new categories gate a real send today vs. are persisted-but-not-
 * yet-enforced; the "Coming soon" labels here are driven by that same
 * `live` flag, not a separate judgment call.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Trophy, Target, Flame, BarChart3, PartyPopper, Megaphone,
  AlertTriangle, Users, Handshake, Star, Gift, CalendarClock, Plane, Loader2,
} from "lucide-react";
import Toggle from "@/components/ui/Toggle";
import Skeleton from "@/components/ui/Skeleton";
import { HOUR_OPTIONS } from "@/lib/hourOptions";

type Preferences = {
  achievements: boolean;
  goal_reminders: boolean;
  streak_reminders: boolean;
  weekly_summaries: boolean;
  milestone_celebrations: boolean;
  product_announcements: boolean;
  groups: boolean;
  partners: boolean;
  xp: boolean;
  referrals: boolean;
  monthly_summaries: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: number;
  quiet_hours_end: number;
  vacation_mode: boolean;
  vacation_until: string | null;
  digest_frequency: "immediate" | "hourly" | "daily" | "weekly";
};

type BoolCategory = Exclude<
  keyof Preferences,
  "quiet_hours_enabled" | "quiet_hours_start" | "quiet_hours_end" | "vacation_mode" | "vacation_until" | "digest_frequency"
>;

const CATEGORY_META: {
  key: BoolCategory;
  icon: React.ReactNode;
  title: string;
  description: string;
  /** Whether this category currently gates a real notification send — see
   *  the migration file for the full explanation of which ones don't yet. */
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
    description: "Daily quest, weekly quest, challenge deadlines, and goal-progress nudges",
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
    key: "monthly_summaries",
    icon: <CalendarClock size={16} className="text-blue-400" />,
    title: "Monthly progress summaries",
    description: "A bigger-picture recap once a month",
    live: false, // Sprint 27 Phase 5 (Digest System) builds the actual sender
  },
  {
    key: "milestone_celebrations",
    icon: <PartyPopper size={16} className="text-emerald-400" />,
    title: "Saving milestone celebrations",
    description: "Big deposits, goal completions, and other wins",
    live: true, // Sprint 17: wired to a real send (goal completion only — see audit)
  },
  {
    key: "groups",
    icon: <Users size={16} className="text-cyan-400" />,
    title: "Group activity",
    description: "Invites, shared-goal invites, and group quests ending soon",
    live: true, // Sprint 27 Phase 4
  },
  {
    key: "partners",
    icon: <Handshake size={16} className="text-pink-400" />,
    title: "Accountability partner activity",
    description: "Requests, nudges, and check-in reminders",
    live: true, // Sprint 27 Phase 4
  },
  {
    key: "xp",
    icon: <Star size={16} className="text-yellow-400" />,
    title: "XP notifications",
    description: "Standalone XP-gain alerts, separate from achievements",
    live: false, // No send path exists yet distinct from achievement_unlocked
  },
  {
    key: "referrals",
    icon: <Gift size={16} className="text-rose-400" />,
    title: "Referral notifications",
    description: "When someone joins using your referral link",
    live: false, // No referral feature exists anywhere in this app yet
  },
  {
    key: "product_announcements",
    icon: <Megaphone size={16} className="text-white/50" />,
    title: "Marketing & product announcements",
    description: "New features and occasional SaveQuest news",
    live: false, // Still no sender — no content/CMS system exists for this yet
  },
];

const DIGEST_OPTIONS: { value: Preferences["digest_frequency"]; label: string; live: boolean }[] = [
  { value: "immediate", label: "Immediate — as things happen", live: true },
  { value: "daily", label: "Daily digest", live: false },
  { value: "weekly", label: "Weekly digest", live: false },
  { value: "hourly", label: "Hourly digest", live: false },
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

  /**
   * Generalized from Sprint 16's single-boolean handleToggle to accept any
   * patch — quiet hours and digest frequency aren't plain booleans, but the
   * "flip optimistically, PATCH in the background, revert on failure" shape
   * is identical, so one function covers every control on this page rather
   * than a second near-duplicate for the non-boolean ones.
   */
  async function handleUpdate(patch: Partial<Preferences>, savingKeyName: string) {
    if (!prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, ...patch }); // optimistic
    setSavingKey(savingKeyName);
    try {
      const res = await fetch("/api/notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
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
        <>
          <p className="text-xs text-white/50 uppercase tracking-wider font-medium mb-3">Categories</p>
          <div className="space-y-2">
            {CATEGORY_META.map(({ key, icon, title, description, live }) => (
              <div key={key} className="card p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center flex-shrink-0">
                    {icon}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white">{title}</p>
                    <p className="text-xs text-white/50 mt-0.5">{description}</p>
                    {!live && (
                      <p className="text-[10px] text-white/50 mt-1">Coming soon — your preference is saved and will apply once this notification type ships.</p>
                    )}
                  </div>
                </div>
                <Toggle
                  checked={prefs[key]}
                  onChange={(v) => handleUpdate({ [key]: v } as Partial<Preferences>, key)}
                  disabled={savingKey === key}
                  label={title}
                />
              </div>
            ))}
          </div>

          {/* Quiet hours */}
          <p className="text-xs text-white/50 uppercase tracking-wider font-medium mb-3 mt-6">Quiet hours</p>
          <div className="card p-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center flex-shrink-0">
                  <CalendarClock size={16} className="text-indigo-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">Pause notifications overnight</p>
                  <p className="text-xs text-white/50 mt-0.5">Reminders won&apos;t be sent during this window, in your local time</p>
                </div>
              </div>
              <Toggle
                checked={prefs.quiet_hours_enabled}
                onChange={(v) => handleUpdate({ quiet_hours_enabled: v }, "quiet_hours_enabled")}
                disabled={savingKey === "quiet_hours_enabled"}
                label="Pause notifications overnight"
              />
            </div>

            {prefs.quiet_hours_enabled && (
              <div className="flex items-center gap-2">
                <select
                  className="input-field flex-1"
                  value={prefs.quiet_hours_start}
                  onChange={(e) => handleUpdate({ quiet_hours_start: Number(e.target.value) }, "quiet_hours_start")}
                  aria-label="Quiet hours start"
                >
                  {HOUR_OPTIONS.map((h) => (
                    <option key={h.value} value={h.value}>{h.label}</option>
                  ))}
                </select>
                <span className="text-xs text-white/50 shrink-0">to</span>
                <select
                  className="input-field flex-1"
                  value={prefs.quiet_hours_end}
                  onChange={(e) => handleUpdate({ quiet_hours_end: Number(e.target.value) }, "quiet_hours_end")}
                  aria-label="Quiet hours end"
                >
                  {HOUR_OPTIONS.map((h) => (
                    <option key={h.value} value={h.value}>{h.label}</option>
                  ))}
                </select>
              </div>
            )}
            <p className="text-[10px] text-white/50">
              Covers your daily streak/quest/goal reminders. Doesn&apos;t yet cover instant notifications like partner requests or achievement unlocks — those still arrive any time.
            </p>
          </div>

          {/* Vacation mode */}
          <p className="text-xs text-white/50 uppercase tracking-wider font-medium mb-3 mt-6">Vacation mode</p>
          <div className="card p-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center flex-shrink-0">
                  <Plane size={16} className="text-sky-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">Pause everything</p>
                  <p className="text-xs text-white/50 mt-0.5">Mutes every notification — reminders, social, everything — until you turn it off</p>
                </div>
              </div>
              <Toggle
                checked={prefs.vacation_mode}
                onChange={(v) => handleUpdate({ vacation_mode: v }, "vacation_mode")}
                disabled={savingKey === "vacation_mode"}
                label="Pause everything"
              />
            </div>

            {prefs.vacation_mode && (
              <div>
                <label htmlFor="vacation-until-date" className="block text-xs text-white/50 mb-1.5">Resume on (optional)</label>
                <input
                  id="vacation-until-date"
                  type="date"
                  className="input-field w-full"
                  value={prefs.vacation_until ?? ""}
                  onChange={(e) => handleUpdate({ vacation_until: e.target.value || null }, "vacation_until")}
                />
                <p className="text-[10px] text-white/50 mt-1.5">
                  Leave blank to stay paused until you switch this off yourself.
                </p>
              </div>
            )}
          </div>

          {/* Digest frequency */}
          <p className="text-xs text-white/50 uppercase tracking-wider font-medium mb-3 mt-6">Delivery frequency</p>
          <div className="card p-4">
            <select
              className="input-field w-full"
              value={prefs.digest_frequency}
              onChange={(e) => handleUpdate({ digest_frequency: e.target.value as Preferences["digest_frequency"] }, "digest_frequency")}
              disabled={savingKey === "digest_frequency"}
              aria-label="Notification delivery frequency"
            >
              {DIGEST_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}{!o.live ? " (coming soon)" : ""}</option>
              ))}
            </select>
            {savingKey === "digest_frequency" && (
              <p className="text-[10px] text-white/50 mt-2 flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Saving…</p>
            )}
            <p className="text-[10px] text-white/50 mt-2">
              Only &quot;Immediate&quot; is active today. Digests bundle multiple notifications into one delivery — that
              batching engine hasn&apos;t shipped yet, so choosing hourly/daily/weekly saves your preference but
              doesn&apos;t change what you receive until it does.
            </p>
          </div>
        </>
      )}

      <p className="text-xs text-white/50 mt-5">
        These control which types of notifications you receive. You can turn push notifications off entirely from the main Settings page.
      </p>
    </div>
  );
}
