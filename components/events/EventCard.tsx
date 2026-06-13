"use client";

/**
 * components/events/EventCard.tsx — SECURITY HARDENED
 *
 * Changes from original:
 *  • handleComplete() now calls POST /api/events/complete — no direct
 *    Supabase profile writes from the browser.
 *  • handleJoin() still calls Supabase directly (join is XP-free and
 *    the user_event_participation table is RLS-scoped to the user).
 *  • XP reward displayed from server-resolved event prop only.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { SaveQuestEvent, EventWindow } from "@/lib/events";
import EventCountdownBadge from "./EventCountdownBadge";
import { Zap, Lock } from "lucide-react";

interface Props {
  event: SaveQuestEvent & { window: EventWindow };
  userId: string;
  participationStatus: "none" | "active" | "completed" | "expired";
}

export default function EventCard({ event, userId, participationStatus }: Props) {
  const router = useRouter();
  const [loading, setLoading]         = useState(false);
  const [localStatus, setLocalStatus] = useState(participationStatus);

  const isJoined    = localStatus === "active";
  const isCompleted = localStatus === "completed";
  const canJoin     = event.window.canJoin && localStatus === "none";
  const isUpcoming  = event.window.status === "upcoming";

  // Join is XP-free — direct Supabase insert is acceptable here.
  // The user_event_participation table has RLS (auth.uid() = user_id)
  // and a UNIQUE (user_id, event_slug) constraint.
  async function handleJoin() {
    if (!canJoin) return;
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.from("user_event_participation").insert({
      user_id:    userId,
      event_slug: event.id,
      status:     "active",
      joined_at:  new Date().toISOString(),
    });
    if (!error) setLocalStatus("active");
    setLoading(false);
    router.refresh();
  }

  // Complete goes through the server route — no direct profile.xp_total write.
  async function handleComplete() {
    if (!isJoined) return;
    setLoading(true);

    const res  = await fetch("/api/events/complete", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ eventSlug: event.id }),
    });
    const data = await res.json();

    if (!res.ok) {
      console.error("[EventCard.handleComplete]", data.error);
      setLoading(false);
      return;
    }

    setLocalStatus("completed");
    setLoading(false);
    router.refresh();
  }

  return (
    <div className={`card p-4 transition-all duration-200 ${
      isUpcoming  ? "opacity-70 border-brand-500/10" :
      isCompleted ? "border-emerald-500/15 opacity-75" :
      isJoined    ? "border-brand-500/25" :
                    ""
    }`}>
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 border ${
          isUpcoming  ? "bg-surface-elevated border-surface-border" :
          isCompleted ? "bg-emerald-500/10 border-emerald-500/20" :
          isJoined    ? "bg-brand-500/10 border-brand-500/20" :
                        "bg-surface-elevated border-surface-border"
        }`}>
          {isCompleted ? "✅" : event.emoji}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-0.5">
            <p className="font-display font-semibold text-white text-sm leading-tight">{event.title}</p>
            <div className="flex items-center gap-1 bg-surface-elevated border border-surface-border rounded-full px-2 py-0.5 flex-shrink-0">
              <Zap size={10} className="text-white/40" />
              <span className="text-white/50 text-[10px] font-bold">{event.xp_reward}</span>
            </div>
          </div>
          <p className="text-xs text-white/40 leading-snug">{event.description}</p>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span className="text-[10px] text-white/25 border border-surface-border rounded-full px-1.5 py-0.5 capitalize">
              {event.event_type.replace("_", " ")}
            </span>
            <EventCountdownBadge window={event.window} />
          </div>
        </div>
      </div>

      {isCompleted && (
        <div className="text-center text-emerald-400 text-xs font-medium py-1.5">
          ✅ Completed · +{event.xp_reward} XP earned
        </div>
      )}

      {isJoined && !isCompleted && (
        <button
          onClick={handleComplete}
          disabled={loading}
          className="btn-primary w-full text-sm py-2.5"
        >
          {loading ? "Claiming…" : "Mark Complete ✅"}
        </button>
      )}

      {canJoin && (
        <button
          onClick={handleJoin}
          disabled={loading}
          className="btn-ghost w-full text-sm py-2.5"
        >
          {loading ? "Joining…" : `Join Event ${event.emoji}`}
        </button>
      )}

      {isUpcoming && (
        <div className="flex items-center justify-center gap-1.5 py-2 text-white/30 text-xs">
          <Lock size={11} />
          <span>Available {event.window.countdownLabel?.replace("Starts", "starts") ?? "soon"}</span>
        </div>
      )}
    </div>
  );
}
