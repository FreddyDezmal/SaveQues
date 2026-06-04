"use client";

import type { EventWindow } from "@/lib/events";

interface Props {
  window: EventWindow;
  size?: "sm" | "md";
}

const URGENCY_STYLES: Record<EventWindow["urgency"], { bg: string; text: string; border: string }> = {
  none:     { bg: "bg-surface-elevated",  text: "text-white/30",    border: "border-surface-border"  },
  low:      { bg: "bg-brand-500/8",       text: "text-brand-400",   border: "border-brand-500/20"    },
  medium:   { bg: "bg-orange-500/10",     text: "text-orange-400",  border: "border-orange-500/20"   },
  high:     { bg: "bg-red-500/10",        text: "text-red-400",     border: "border-red-500/20"      },
  critical: { bg: "bg-red-500/15",        text: "text-red-400",     border: "border-red-500/30"      },
};

export default function EventCountdownBadge({ window: w, size = "sm" }: Props) {
  if (!w.countdownLabel) return null;

  const style = URGENCY_STYLES[w.urgency];
  const textSize = size === "sm" ? "text-[10px]" : "text-xs";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 border font-medium ${textSize} ${style.bg} ${style.text} ${style.border} ${
        w.urgency === "critical" ? "animate-pulse" : ""
      }`}
    >
      {w.status === "upcoming" ? "⏳" : w.urgency === "critical" ? "🔥" : "⏱"}
      {w.countdownLabel}
    </span>
  );
}
