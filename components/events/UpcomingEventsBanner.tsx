"use client";

import Link from "next/link";
import type { SaveQuestEvent, EventWindow } from "@/lib/events";
import EventCountdownBadge from "./EventCountdownBadge";
import { ChevronRight } from "lucide-react";

interface Props {
  events: (SaveQuestEvent & { window: EventWindow })[];
}

export default function UpcomingEventsBanner({ events }: Props) {
  if (events.length === 0) return null;

  // Show max 3, active first then upcoming
  const visible = events.slice(0, 3);
  const hasActive   = visible.some(e => e.window.status === "active");
  const hasUpcoming = visible.some(e => e.window.status === "upcoming");

  const headerLabel = hasActive && hasUpcoming
    ? "Events"
    : hasActive
    ? "Active Events"
    : "Upcoming Events";

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-display font-semibold text-white text-sm">{headerLabel}</h2>
        <Link
          href="/events"
          className="text-brand-400 text-xs flex items-center gap-0.5 hover:text-brand-300 transition-colors"
        >
          See all <ChevronRight size={12} />
        </Link>
      </div>

      <div className="space-y-2">
        {visible.map(event => (
          <Link key={event.id} href="/events" className="block">
            <div className={`card p-3 flex items-center gap-3 hover:border-white/10 transition-colors ${
              event.window.status === "active" ? "border-brand-500/15" : "opacity-70"
            }`}>
              <div className="w-9 h-9 rounded-xl bg-surface-elevated border border-surface-border flex items-center justify-center text-lg flex-shrink-0">
                {event.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{event.title}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <EventCountdownBadge window={event.window} size="sm" />
                  <span className="text-[10px] text-white/30">· {event.xp_reward} XP</span>
                </div>
              </div>
              <ChevronRight size={14} className="text-white/20 flex-shrink-0" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
