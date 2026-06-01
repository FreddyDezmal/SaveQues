"use client";

import { Flame } from "lucide-react";

export default function StreakBadge({ streak, paused = false }: { streak: number; paused?: boolean }) {
  const isHot  = !paused && streak >= 7;
  const isMega = !paused && streak >= 30;

  return (
    <div
      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border transition-all ${
        paused
          ? "bg-surface-elevated border-surface-border opacity-60"
          : isMega
          ? "bg-yellow-500/10 border-yellow-500/30 animate-pulse-glow"
          : isHot
          ? "bg-orange-500/10 border-orange-500/30"
          : "bg-surface-elevated border-surface-border"
      }`}
    >
      <Flame
        size={16}
        className={`${
          paused ? "text-white/20" :
          isMega  ? "text-yellow-400 animate-streak-fire" :
          isHot   ? "text-orange-400" :
                    "text-white/30"
        }`}
        fill={isHot ? "currentColor" : "none"}
      />
      <span
        className={`font-display font-bold text-sm ${
          paused ? "text-white/30" :
          isMega  ? "text-yellow-400" :
          isHot   ? "text-orange-400" :
                    "text-white/40"
        }`}
      >
        {paused ? "⏸" : streak}
      </span>
      <span className="text-white/30 text-xs">{paused ? "paused" : "streak"}</span>
    </div>
  );
}
