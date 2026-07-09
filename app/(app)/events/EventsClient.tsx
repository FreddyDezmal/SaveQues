"use client";

import { useState } from "react";
import type { SaveQuestEvent, EventWindow } from "@/lib/events";
import { STATIC_EVENTS } from "@/lib/events";
import EventCard from "@/components/events/EventCard";
import EmptyState from "@/components/ui/EmptyState";
import { Calendar, Clock, Trophy } from "lucide-react";

interface Props {
  events: (SaveQuestEvent & { window: EventWindow })[];
  participationMap: Record<string, "active" | "completed" | "expired">;
  history: { event_slug: string; status: string; completed_at: string | null; xp_earned: number | null }[];
  userId: string;
}

type EventTab = "active" | "upcoming" | "history";

export default function EventsClient({ events, participationMap, history, userId }: Props) {
  const [activeTab, setActiveTab] = useState<EventTab>("active");

  const activeEvents   = events.filter(e => e.window.status === "active");
  const upcomingEvents = events.filter(e => e.window.status === "upcoming");

  const TABS: { id: EventTab; label: string; icon: React.ReactNode; count: number }[] = [
    { id: "active",   label: "Active",   icon: <Clock size={13} />,    count: activeEvents.length   },
    { id: "upcoming", label: "Upcoming", icon: <Calendar size={13} />, count: upcomingEvents.length },
    { id: "history",  label: "History",  icon: <Trophy size={13} />,   count: history.length        },
  ];

  return (
    <div className="max-w-lg mx-auto px-4 pt-6 pb-8">
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold text-white">Events</h1>
        <p className="text-white/40 text-sm mt-0.5">
          Time-limited challenges with big XP rewards
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1.5 mb-5 bg-surface-elevated p-1 rounded-2xl">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-medium transition-all duration-200 relative ${
              activeTab === t.id ? "bg-brand-500 text-black" : "text-white/40 hover:text-white/70"
            }`}
          >
            {t.icon}
            <span>{t.label}</span>
            {t.count > 0 && (
              <span className={`absolute top-1 right-1 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center ${
                activeTab === t.id ? "bg-black/20 text-black" : "bg-brand-500 text-black"
              }`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── ACTIVE TAB ─────────────────────────────── */}
      {activeTab === "active" && (
        <div className="space-y-3">
          {activeEvents.length === 0 ? (
            <EmptyState
              emoji="⚡"
              title="No active events right now"
              description="Check the Upcoming tab — something might be starting soon."
            />
          ) : (
            activeEvents.map(event => (
              <EventCard
                key={event.id}
                event={event}
                userId={userId}
                participationStatus={participationMap[event.id] ?? "none"}
              />
            ))
          )}
        </div>
      )}

      {/* ── UPCOMING TAB ───────────────────────────── */}
      {activeTab === "upcoming" && (
        <div className="space-y-3">
          {upcomingEvents.length === 0 ? (
            <EmptyState
              emoji="📅"
              title="Nothing upcoming right now"
              description="New events are added regularly — check back soon."
            />
          ) : (
            <>
              <div className="px-4 py-2.5 rounded-xl bg-surface-elevated border border-surface-border mb-2">
                <p className="text-xs text-white/40">
                  🔒 These events aren&apos;t open yet. You&apos;ll be able to join when they start.
                </p>
              </div>
              {upcomingEvents.map(event => (
                <EventCard
                  key={event.id}
                  event={event}
                  userId={userId}
                  participationStatus={participationMap[event.id] ?? "none"}
                />
              ))}
            </>
          )}
        </div>
      )}

      {/* ── HISTORY TAB ────────────────────────────── */}
      {activeTab === "history" && (
        <div className="space-y-3">
          {history.length === 0 ? (
            <EmptyState
              emoji="🏅"
              title="No completed events yet"
              description="Complete an active event and it will appear here."
            />
          ) : (
            <>
              {/* XP summary */}
              <div className="card p-4 text-center mb-2">
                <p className="font-display font-bold text-white text-2xl">
                  {history.reduce((sum, h) => sum + (h.xp_earned ?? 0), 0).toLocaleString()}
                </p>
                <p className="text-xs text-white/40 mt-0.5">Total XP from events</p>
              </div>

              {history.map(h => {
                // Look up the event definition from static catalog
                const def = STATIC_EVENTS.find(e => e.id === h.event_slug);
                const title = def?.title ?? h.event_slug;
                const emoji = def?.emoji ?? "⚡";
                return (
                  <div key={h.event_slug} className="card p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-xl">
                        {emoji}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">{title}</p>
                        {h.completed_at && (
                          <p className="text-xs text-white/30 mt-0.5">
                            {new Date(h.completed_at).toLocaleDateString("en", {
                              day: "numeric", month: "short", year: "numeric",
                            })}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-emerald-400">+{h.xp_earned ?? 0} XP</p>
                      <p className="text-[10px] text-emerald-400/60">Completed</p>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
