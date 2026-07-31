"use client";

import { getMomentumState } from "@/lib/momentum";
import { getUTCDateString, getLastNUTCDateStrings } from "@/lib/dateUtils";

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

  // Use UTC calendar dates throughout — must match activity_log.activity_date
  // (written via CURRENT_DATE / explicit UTC dates) and getMomentumState's
  // 14-day window, or "today" can disappear or land on the wrong cell near
  // midnight for users in non-UTC timezones. See lib/dateUtils.ts.
  const todayStr = getUTCDateString();
  const dateStrings = getLastNUTCDateStrings(daysToShow);

  const days = dateStrings.map(dateStr => {
    const activity = activityMap.get(dateStr);
    return {
      date: dateStr,
      xp: activity?.xp_earned ?? 0,
      actions: activity?.actions_count ?? 0,
      isToday: dateStr === todayStr,
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

      {/* Sprint 28.5 — Phase 6/10: screen-reader description. The grid below
          is decorative (aria-hidden) — same pattern GitHub's own
          contribution heatmap uses: a 30-cell grid of individual
          aria-labels is more noise than signal for a screen-reader user,
          so one concise, complete summary replaces it rather than
          supplementing it. Every number in this sentence already existed
          (activeDays, daysToShow, totalXP, momentum.label) — this isn't
          new data, just the first accessible text carrying all of it at
          once. */}
      <p className="sr-only">
        {headerLabel}: {activeDays} of {daysToShow} days active
        {totalXP > 0 ? `, ${totalXP.toLocaleString()} XP earned` : ""}. Momentum: {momentum.label}. {momentum.description}
      </p>

      <div
        aria-hidden="true"
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

      {/* Momentum state description — already plain text, already visible to
          screen readers (no aria-hidden here), duplicated into the sr-only
          summary above only so a screen reader user gets the complete
          picture from one place without needing to piece it together from
          two separate elements. */}
      <p className="text-[11px] mb-2" style={{ color: `${momentum.color}99` }}>
        {momentum.description}
      </p>

      <div className="flex items-center gap-1.5" aria-hidden="true">
        <span className="text-[10px] text-white/30">Less</span>
        {["bg-surface-border","bg-emerald-900/60","bg-emerald-700/70","bg-emerald-500/80","bg-emerald-400"].map(cls => (
          <div key={cls} className={`w-3 h-3 rounded-sm ${cls}`} />
        ))}
        <span className="text-[10px] text-white/30">More</span>
      </div>
      {/* Sprint 28.5 — Phase 6/10: the legend above is decorative shorthand
          for "darker green = more XP that day," already stated in the
          sr-only summary's per-day intensity isn't itself narrated (that
          would be excessive detail), but the legend's meaning — what the
          colors represent — is, so hiding the swatches themselves from AT
          doesn't lose any information a screen reader user needs. */}
    </div>
  );
}