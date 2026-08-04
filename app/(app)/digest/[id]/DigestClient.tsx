"use client";

/**
 * app/(app)/digest/[id]/DigestClient.tsx
 * Sprint 27, Phase 5. Renders whichever digest the notification's deep
 * link pointed at — this is the "full breakdown" lib/digest.ts's push
 * copy comment refers to, everything the sprint brief's weekly/monthly
 * examples listed that a short push body can't hold.
 *
 * `payload` is untyped `any` from the server component (JSON round-trip
 * loses the WeeklyDigestData/MonthlyDigestData type) — narrowed here via
 * `digestType` instead of a runtime schema check, since the only writer
 * of this table is this app's own scheduler (lib/notifications.ts),
 * documented in the migration's own comment.
 */

import Link from "next/link";
import { ArrowLeft, Target, Flame, Trophy, TrendingUp, TrendingDown } from "lucide-react";
import { formatAmount } from "@/lib/currency";
import { formatDateShort } from "@/lib/dateFormat";

interface Props {
  digestType: "weekly" | "monthly";
  periodStart: string;
  periodEnd: string;
  payload: any;
  currencyCode: string;
  locale: string;
}

function formatPeriodLabel(start: string, end: string, locale: string): string {
  const s = new Date(`${start}T00:00:00.000Z`);
  const e = new Date(`${end}T00:00:00.000Z`);
  return `${formatDateShort(s, locale)} – ${formatDateShort(e, locale)}`;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3">
      <p className="text-[10px] text-white/50 uppercase tracking-wide">{label}</p>
      <p className="text-lg font-display font-bold text-white mt-0.5">{value}</p>
    </div>
  );
}

/**
 * Hand-rolled bar series — no charting library exists in this codebase
 * (confirmed during the Phase 1 audit), and MomentumHeatmap.tsx already
 * established the "plain divs, sized/colored by value" convention this
 * follows, rather than adding a new dependency for one page.
 *
 * Sprint 27, Phase 12 accessibility fix: this previously had ZERO
 * screen-reader-accessible content — each bar's only data was a `title`
 * attribute, which is a mouse-hover-only tooltip that screen readers
 * don't announce and isn't reachable by keyboard at all. A screen
 * reader user got nothing from these charts. Fixed with the standard
 * WAI technique for a "complex image": `role="img"` + a descriptive
 * `aria-label` summarizing the series (total, peak day), plus a
 * visually-hidden (`sr-only`) data table with the same per-day values
 * the sighted bar chart shows, for anyone who wants the detail.
 */
export function BarSeries({ points, colorClass, seriesLabel, formatValue }: { points: { date: string; value: number }[]; colorClass: string; seriesLabel: string; formatValue?: (n: number) => string }) {
  if (points.length === 0) {
    return <p className="text-xs text-white/50 py-4 text-center">No activity in this period yet.</p>;
  }
  const fmt = formatValue ?? ((n: number) => n.toLocaleString());
  const max = Math.max(...points.map((p) => p.value), 1);
  const total = points.reduce((sum, p) => sum + p.value, 0);
  const peak = points.reduce((best, p) => (p.value > best.value ? p : best), points[0]);
  const summary = `${seriesLabel}: ${fmt(total)} total across ${points.length} days. Highest day: ${peak.date} at ${fmt(peak.value)}.`;

  return (
    <div role="img" aria-label={summary}>
      <div className="flex items-end gap-1 h-24" aria-hidden="true">
        {points.map((p) => (
          <div key={p.date} className="flex-1 flex flex-col items-center justify-end h-full">
            <div
              className={`w-full rounded-t-sm ${colorClass} min-h-[2px]`}
              style={{ height: `${Math.max(4, (p.value / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <table className="sr-only">
        <caption>{seriesLabel} by day</caption>
        <thead>
          <tr><th scope="col">Date</th><th scope="col">Value</th></tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.date}><td>{p.date}</td><td>{fmt(p.value)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DigestClient({ digestType, periodStart, periodEnd, payload, currencyCode, locale }: Props) {
  const fc = (n: number) => formatAmount(n, currencyCode, locale);

  return (
    <div className="p-4 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-2">
        <Link href="/dashboard" className="text-white/40 hover:text-white/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 rounded-lg p-1">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="font-display text-xl font-bold text-white">
          {digestType === "weekly" ? "Weekly Recap" : "Monthly Recap"}
        </h1>
      </div>
      <p className="text-xs text-white/50 mb-6 ml-9">{formatPeriodLabel(periodStart, periodEnd, locale)}</p>

      {digestType === "weekly" ? (
        <WeeklyView payload={payload} fc={fc} />
      ) : (
        <MonthlyView payload={payload} fc={fc} />
      )}
    </div>
  );
}

function WeeklyView({ payload, fc }: { payload: any; fc: (n: number) => string }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Saved" value={fc(payload.totalSaved)} />
        <StatCard label="Quests completed" value={String(payload.questsCompleted)} />
        <StatCard label="XP earned" value={`${payload.xpEarned.toLocaleString()} XP`} />
        <StatCard label="Level" value={`Level ${payload.level}`} />
      </div>

      <div className="card p-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-orange-500/10 flex items-center justify-center flex-shrink-0">
          <Flame size={16} className="text-orange-400" />
        </div>
        <div>
          <p className="text-sm font-medium text-white">{payload.streakDays}-day streak</p>
          <p className="text-xs text-white/50">Keep it going next week</p>
        </div>
      </div>

      {payload.closestGoal && (
        <div className="card p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-500/10 flex items-center justify-center flex-shrink-0">
            <Target size={16} className="text-brand-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-white">Closest goal: {payload.closestGoal.title}</p>
            <p className="text-xs text-white/50">{fc(payload.closestGoal.remaining)} left to reach it</p>
          </div>
        </div>
      )}
    </div>
  );
}

function MonthlyView({ payload, fc }: { payload: any; fc: (n: number) => string }) {
  const momentum = payload.momentum;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Saved" value={fc(payload.totalSaved)} />
        <StatCard label="Quests completed" value={String(payload.questsCompleted)} />
        <StatCard label="XP earned" value={`${payload.xpEarned.toLocaleString()} XP`} />
        <StatCard label="Achievements" value={String(payload.achievements.length)} />
      </div>

      {momentum && (
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="text-[10px] font-bold rounded-full px-2 py-0.5 border"
              style={{ color: momentum.color, borderColor: `${momentum.color}40`, backgroundColor: `${momentum.color}12` }}
            >
              {momentum.emoji} {momentum.label}
            </span>
          </div>
          <p className="text-[11px]" style={{ color: `${momentum.color}99` }}>{momentum.description}</p>
        </div>
      )}

      <div className="card p-4">
        <p className="text-xs font-medium text-white mb-3">Savings this month</p>
        <BarSeries points={payload.dailySavings} colorClass="bg-brand-500/70" seriesLabel="Savings" formatValue={fc} />
      </div>

      <div className="card p-4">
        <p className="text-xs font-medium text-white mb-3">XP this month</p>
        <BarSeries points={payload.dailyXP} colorClass="bg-emerald-500/70" seriesLabel="XP" />
      </div>

      {(payload.bestWeek || payload.worstWeek) && (
        <div className="grid grid-cols-2 gap-2">
          {payload.bestWeek && (
            <div className="card p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <TrendingUp size={12} className="text-emerald-400" />
                <p className="text-[10px] text-white/50 uppercase tracking-wide">Best week</p>
              </div>
              <p className="text-sm font-display font-bold text-white">{fc(payload.bestWeek.total)}</p>
              <p className="text-[10px] text-white/50 mt-0.5">Week of {payload.bestWeek.weekStart}</p>
            </div>
          )}
          {payload.worstWeek && (
            <div className="card p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <TrendingDown size={12} className="text-white/40" />
                <p className="text-[10px] text-white/50 uppercase tracking-wide">Slowest week</p>
              </div>
              <p className="text-sm font-display font-bold text-white">{fc(payload.worstWeek.total)}</p>
              <p className="text-[10px] text-white/50 mt-0.5">Week of {payload.worstWeek.weekStart}</p>
            </div>
          )}
        </div>
      )}

      {payload.achievements.length > 0 && (
        <div className="card p-4">
          <p className="text-xs font-medium text-white mb-3">Achievements earned</p>
          <div className="grid grid-cols-2 gap-2">
            {payload.achievements.map((a: { id: string; title: string; icon: string }) => (
              <div key={a.id} className="flex items-center gap-2">
                <span className="text-lg">{a.icon}</span>
                <div className="flex items-center gap-1 min-w-0">
                  <Trophy size={10} className="text-purple-400 shrink-0" />
                  <p className="text-xs text-white/70 truncate">{a.title}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
