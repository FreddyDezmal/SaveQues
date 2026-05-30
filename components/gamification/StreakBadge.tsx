"use client";

import { formatStreakDisplay } from "@/lib/streaks";
import { Flame } from "lucide-react";

export default function StreakBadge({ streak }: { streak: number }) {
  const isHot = streak >= 7;
  const isMega = streak >= 30;

  return (
    <div
      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border transition-all ${
        isMega
          ? "bg-yellow-500/10 border-yellow-500/30 animate-pulse-glow"
          : isHot
          ? "bg-orange-500/10 border-orange-500/30"
          : "bg-surface-elevated border-surface-border"
      }`}
    >
      <Flame
        size={16}
        className={`${
          isMega ? "text-yellow-400 animate-streak-fire" :
          isHot ? "text-orange-400" :
          "text-white/30"
        }`}
        fill={isHot ? "currentColor" : "none"}
      />
      <span
        className={`font-display font-bold text-sm ${
          isMega ? "text-yellow-400" :
          isHot ? "text-orange-400" :
          "text-white/40"
        }`}
      >
        {streak}
      </span>
      <span className="text-white/30 text-xs">streak</span>
    </div>
  );
}
