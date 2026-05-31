"use client";

import { format, subDays } from "date-fns";

interface ActivityDay {
  date: string;
  xp_earned: number;
  actions_count: number;
}

interface Props {
  activityLog: ActivityDay[];
}

export default function MomentumHeatmap({ activityLog }: Props) {
  const activityMap = new Map(activityLog.map(a => [a.date, a]));

  // Build 30-day grid
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = subDays(new Date(), 29 - i);
    const dateStr = format(d, "yyyy-MM-dd");
    const activity = activityMap.get(dateStr);
    return {
      date: dateStr,
      dayLabel: format(d, "d"),
      monthLabel: i === 0 || format(d, "d") === "1" ? format(d, "MMM") : "",
      xp: activity?.xp_earned ?? 0,
      actions: activity?.actions_count ?? 0,
      isToday: dateStr === format(new Date(), "yyyy-MM-dd"),
    };
  });

  function getIntensity(xp: number): string {
    if (xp === 0) return "bg-surface-border";
    if (xp < 100) return "bg-emerald-900/60";
    if (xp < 300) return "bg-emerald-700/70";
    if (xp < 600) return "bg-emerald-500/80";
    return "bg-emerald-400";
  }

  const totalXP = days.reduce((sum, d) => sum + d.xp, 0);
  const activeDays = days.filter(d => d.xp > 0).length;

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display font-semibold text-white text-sm">30-Day Momentum</h3>
        <div className="flex items-center gap-3 text-xs text-white/40">
          <span>{activeDays}/30 days active</span>
          <span className="text-brand-400 font-bold">+{totalXP.toLocaleString()} XP</span>
        </div>
      </div>

      {/* Heatmap grid — 6 columns × 5 rows */}
      <div className="grid grid-cols-10 gap-1 mb-3">
        {days.map(day => (
          <div
            key={day.date}
            title={`${day.date}: ${day.xp} XP, ${day.actions} actions`}
            className={`
              aspect-square rounded-md transition-all duration-200
              ${getIntensity(day.xp)}
              ${day.isToday ? "ring-2 ring-brand-500/60 ring-offset-1 ring-offset-surface-card" : ""}
            `}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-white/30">Less</span>
        {["bg-surface-border", "bg-emerald-900/60", "bg-emerald-700/70", "bg-emerald-500/80", "bg-emerald-400"].map(cls => (
          <div key={cls} className={`w-3 h-3 rounded-sm ${cls}`} />
        ))}
        <span className="text-[10px] text-white/30">More</span>
      </div>
    </div>
  );
}
