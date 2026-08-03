"use client";

/**
 * app/(app)/reports/monthly/MonthlyReportClient.tsx
 * Sprint 30 — Phase 5. Same print-optimised pattern as
 * app/(app)/reports/annual/AnnualReportClient.tsx — see that file's own
 * header for why "Print → Save as PDF" is the real PDF export today.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { useGatedDownload } from "@/lib/hooks/useGatedDownload";
import UpgradePrompt from "@/components/billing/UpgradePrompt";
import type { MonthlyReport } from "@/lib/monthlyReport";
import type { SavingsGoal } from "@/lib/types";

interface Props {
  report: MonthlyReport;
  goals: Pick<SavingsGoal, "id" | "title">[];
  currencyCode: string;
  locale: string;
}

const HEALTH_LABEL: Record<string, string> = {
  Excellent: "Excellent",
  Good: "Good",
  "Needs Attention": "Needs attention",
  "At Risk": "At risk",
};

// Sprint 30 — Phase 8 (Explainability audit): mostImprovedMetric.metric is
// an internal key (see lib/monthlyReport.ts — currently only ever
// "monthly_savings", compared against last month's total), not display
// text. Mapping it here rather than in the lib keeps that module's
// output stable/testable while fixing the real bug: this used to render
// the raw key directly ("monthly_savings improved 25%") with no stated
// comparison baseline at all.
const METRIC_LABEL: Record<string, string> = {
  monthly_savings: "Your monthly savings",
};

export default function MonthlyReportClient({ report, goals, currencyCode, locale }: Props) {
  const router = useRouter();
  const { download, downloading, blocked, clearBlocked } = useGatedDownload();
  const fmt = (n: number) => formatCurrency(n, currencyCode, locale);
  const goalById = new Map(goals.map((g) => [g.id, g]));
  const forecastByGoal = new Map(report.forecastSummary.map((f) => [f.goalId, f]));
  const [year, month] = report.monthKey.split("-");
  const monthLabel = new Date(Date.UTC(Number(year), Number(month) - 1, 1)).toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  if (!report.hasEnoughData) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        <Link href="/dashboard" className="text-sm text-white/60 hover:text-white/90 transition-colors">
          ← Back to dashboard
        </Link>
        <div className="card p-6 mt-6 text-center">
          <p className="text-white/70">Not enough activity yet this month for a report — make a few deposits and check back.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 print:p-0 print:max-w-none">
      <div className="print:hidden flex items-center justify-between gap-3 mb-6">
        <Link href="/dashboard" className="text-sm text-white/60 hover:text-white/90 transition-colors">
          ← Back to dashboard
        </Link>
        <div className="flex items-center gap-2">
          <button
            onClick={() => download(`/api/export/monthly-report?format=csv`, `savequest-monthly-report-${report.monthKey}.csv`)}
            disabled={downloading !== null}
            className="text-sm px-3 py-1.5 rounded-lg border border-white/15 text-white/70 hover:text-white hover:border-white/30 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
          >
            {downloading ? "Preparing…" : "Download CSV"}
          </button>
          <button
            onClick={() => window.print()}
            className="text-sm px-3 py-1.5 rounded-lg bg-brand-500 text-black font-semibold hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
          >
            Print / Save as PDF
          </button>
        </div>
      </div>

      {blocked && (
        <UpgradePrompt
          message={blocked.message}
          usageDetail={blocked.limit !== null && blocked.used !== null ? `${blocked.used} of ${blocked.limit} exports used this period` : undefined}
          onUpgradeClick={() => {
            clearBlocked();
            router.push("/settings/billing");
          }}
          className="print:hidden mb-6"
        />
      )}

      <header className="mb-6">
        <h1 className="text-2xl font-bold text-white print:text-black">{monthLabel} Report</h1>
        <p className="text-sm text-white/60 print:text-black/60">This month, generated fresh today.</p>
      </header>

      <section className="card p-4 mb-4 print:border print:border-black/20" aria-labelledby="totals-heading">
        <h2 id="totals-heading" className="text-sm font-semibold text-white/90 print:text-black mb-2">Totals</h2>
        <p className="text-3xl font-bold text-white print:text-black">{fmt(report.monthlySavings)}</p>
        {report.savingsChangeFromPreviousMonth.percent !== null && (
          <p className="text-sm text-white/60 print:text-black/70 mt-1">
            {report.savingsChangeFromPreviousMonth.amount >= 0 ? "Up" : "Down"}{" "}
            {Math.abs(Math.round(report.savingsChangeFromPreviousMonth.percent))}% vs last month
          </p>
        )}
        <p className="text-sm text-white/60 print:text-black/70 mt-1">
          {report.depositFrequency.toFixed(1)} deposits/week
          {report.averageDeposit !== null && ` · ${fmt(report.averageDeposit)} average deposit`}
        </p>
        <p className="text-sm text-white/60 print:text-black/70 mt-1">
          {report.goalsCompleted} goal{report.goalsCompleted === 1 ? "" : "s"} completed · {report.achievementsUnlocked} achievement{report.achievementsUnlocked === 1 ? "" : "s"} · {report.xpEarned} XP
        </p>
      </section>

      {report.bestSavingDay && (
        <section className="card p-4 mb-4 print:border print:border-black/20">
          <h2 className="text-sm font-semibold text-white/90 print:text-black mb-1">Best saving day</h2>
          <p className="text-white/85 print:text-black">
            {new Date(report.bestSavingDay.date + "T00:00:00Z").toLocaleDateString(locale, { timeZone: "UTC" })} — {fmt(report.bestSavingDay.amount)}
          </p>
        </section>
      )}

      {report.goalHealthSummary.length > 0 && (
        <section className="card p-4 mb-4 print:border print:border-black/20" aria-labelledby="goals-heading">
          <h2 id="goals-heading" className="text-sm font-semibold text-white/90 print:text-black mb-3">Your goals right now</h2>
          <table className="w-full text-sm">
            <caption className="sr-only">Health and pace for each active goal</caption>
            <thead>
              <tr className="text-left text-white/50 print:text-black/60">
                <th scope="col" className="font-normal pb-1">Goal</th>
                <th scope="col" className="font-normal pb-1">Status</th>
                <th scope="col" className="font-normal pb-1 text-right">Projected completion</th>
              </tr>
            </thead>
            <tbody>
              {report.goalHealthSummary.map((h) => {
                const forecast = forecastByGoal.get(h.goalId);
                return (
                  <tr key={h.goalId}>
                    <td className="py-1 text-white/85 print:text-black">{goalById.get(h.goalId)?.title ?? "(deleted goal)"}</td>
                    <td className="py-1 text-white/70 print:text-black/70">{HEALTH_LABEL[h.status] ?? h.status}</td>
                    <td className="py-1 text-right text-white/70 print:text-black/70">
                      {forecast?.projectedCompletionDate
                        ? new Date(forecast.projectedCompletionDate + "T00:00:00Z").toLocaleDateString(locale, { timeZone: "UTC" })
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {report.coachingSummary.length > 0 && (
        <section className="card p-4 mb-4 print:border print:border-black/20" aria-labelledby="coaching-heading">
          <h2 id="coaching-heading" className="text-sm font-semibold text-white/90 print:text-black mb-2">This month&apos;s coaching</h2>
          <ul className="space-y-1.5">
            {report.coachingSummary.map((line, i) => (
              <li key={i} className="text-sm text-white/85 print:text-black">{line}</li>
            ))}
          </ul>
        </section>
      )}

      {(report.mostImprovedMetric || report.mostConsistentWeek || report.topMilestone) && (
        <section className="card p-4 mb-4 print:border print:border-black/20">
          <h2 className="text-sm font-semibold text-white/90 print:text-black mb-2">Highlights</h2>
          <ul className="space-y-1.5 text-sm text-white/85 print:text-black">
            {report.topMilestone && <li>{report.topMilestone}</li>}
            {report.mostImprovedMetric && (
              <li>
                {METRIC_LABEL[report.mostImprovedMetric.metric] ?? report.mostImprovedMetric.metric} improved{" "}
                {Math.round(report.mostImprovedMetric.percentImproved)}% vs last month
              </li>
            )}
            {report.mostConsistentWeek && (
              <li>
                Most consistent week: {new Date(report.mostConsistentWeek.weekStart + "T00:00:00Z").toLocaleDateString(locale, { timeZone: "UTC" })} ({report.mostConsistentWeek.count} deposits)
              </li>
            )}
          </ul>
        </section>
      )}

      <p className="print:hidden text-xs text-white/40 mt-4">
        Streak: {report.currentStreak} days (longest: {report.longestStreak})
      </p>
    </div>
  );
}
