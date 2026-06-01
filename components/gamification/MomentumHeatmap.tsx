"use client";

import { format, subDays } from "date-fns";
import { getMomentumState } from "@/lib/momentum";

interface ActivityDay {
  date: string;
  xp_earned: number;
  actions_count: number;
}

interface Props {
  activityLog: ActivityDay[];
  userStage?: "new" | "building" | "established";
}

export default function MomentumHeatmap({ activityLog, userStage = "established" }: Props) {
  const activityMap = new Map(activityLog.map(a => [a.date, a]));
  const daysToShow = userStage === "building" ? 14 : 30;

  const days = Array.from({ length: daysToShow }, (_, i) => {
    const d = subDays(new Date(), daysToShow - 1 - i);
    const dateStr = format(d, "yyyy-MM-dd");
    const activity = activityMap.get(dateStr);
    return {
      date: dateStr,
      xp: activity?.xp_earned ?? 0,
      actions: activity?.actions_count ?? 0,
      isToday: dateStr === format(new Date(), "yyyy-MM-dd"),
    };
  });

  function getIntensity(xp: number): string {
    if (xp === 0)   return "bg-surface-border";
    if (xp < 100)  return "bg-emerald-900/60";
    if (xp < 300)  return "bg-emerald-700/70";
    if (xp < 600)  return "bg-emerald-500/80";
    return "bg-emerald-400";
  }

  const totalXP    = days.reduce((sum, d) => sum + d.xp, 0);
  const activeDays = days.filter(d => d.xp > 0).length;

  // Momentum state — emotional label, not a score
  const momentum = getMomentumState(activityLog);

  const headerLabel = userStage === "building" ? "14-Day Momentum" : "30-Day Momentum";
  const subLabel    = activeDays === 0
    ? "Your momentum is building — keep going"
    : `${activeDays}/${daysToShow} days active`;

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="font-display font-semibold text-white text-sm">{headerLabel}</h3>
          {/* Momentum state badge */}
          <span
            className="text-[10px] font-bold rounded-full px-2 py-0.5 border"
            style={{
              color: momentum.color,
              borderColor: `${momentum.color}40`,
              backgroundColor: `${momentum.color}12`,
            }}
          >
            {momentum.emoji} {momentum.label}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-white/40">
          <span>{subLabel}</span>
          {totalXP > 0 && (
            <span className="text-brand-400 font-bold">+{totalXP.toLocaleString()} XP</span>
          )}
        </div>
      </div>

      <div
        className="gap-1 mb-3"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${daysToShow === 14 ? 7 : 10}, minmax(0, 1fr))`,
        }}
      >
        {days.map(day => (
          <div
            key={day.date}
            title={`${day.date}: ${day.xp} XP`}
            className={`
              aspect-square rounded-md transition-all duration-200
              ${getIntensity(day.xp)}
              ${day.isToday ? "ring-2 ring-brand-500/60 ring-offset-1 ring-offset-surface-card" : ""}
            `}
          />
        ))}
      </div>

      {/* Momentum state description */}
      <p className="text-[11px] mb-2" style={{ color: `${momentum.color}99` }}>
        {momentum.description}
      </p>

      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-white/30">Less</span>
        {["bg-surface-border","bg-emerald-900/60","bg-emerald-700/70","bg-emerald-500/80","bg-emerald-400"].map(cls => (
          <div key={cls} className={`w-3 h-3 rounded-sm ${cls}`} />
        ))}
        <span className="text-[10px] text-white/30">More</span>
      </div>
    </div>
  );
}