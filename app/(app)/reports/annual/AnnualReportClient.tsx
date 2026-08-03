"use client";

/**
 * app/(app)/reports/annual/AnnualReportClient.tsx
 *
 * Print-optimised: the @media print block hides navigation/buttons and
 * lays the report out as a clean document, so "Print → Save as PDF" in
 * the browser produces a real, correctly laid-out PDF today. See
 * lib/exportCenter.ts's file-header note on why there's no
 * server-generated binary PDF yet.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { useGatedDownload } from "@/lib/hooks/useGatedDownload";
import UpgradePrompt from "@/components/billing/UpgradePrompt";
import type { AnnualReport } from "@/lib/exportCenter";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface Props {
  report: AnnualReport;
  currencyCode: string;
  locale: string;
  earliestYear: number;
  latestYear: number;
}

export default function AnnualReportClient({ report, currencyCode, locale, earliestYear, latestYear }: Props) {
  const router = useRouter();
  const fmt = (n: number) => formatCurrency(n, currencyCode, locale);
  const { download, downloading, blocked, clearBlocked } = useGatedDownload();
  const years = Array.from({ length: latestYear - earliestYear + 1 }, (_, i) => latestYear - i);
  const maxMonthTotal = Math.max(1, ...report.monthlyBreakdown.map((m) => m.total));
  const topCategories = [...report.categoryBreakdown].filter((c) => c.totalSaved > 0).sort((a, b) => b.totalSaved - a.totalSaved);

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 print:p-0 print:max-w-none">
      {/* ── Screen-only controls — hidden when printed ───────────────────── */}
      <div className="print:hidden flex flex-wrap items-center justify-between gap-3 mb-6">
        <Link href="/dashboard" className="text-sm text-white/60 hover:text-white/90 transition-colors">
          ← Back to dashboard
        </Link>
        <div className="flex items-center gap-2">
          <label htmlFor="report-year" className="text-sm text-white/60">Year</label>
          <select
            id="report-year"
            value={report.year}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => router.push(`/reports/annual?year=${e.target.value}`)}
            className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-sm text-white"
          >
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button
            onClick={() => window.print()}
            className="text-sm px-3 py-1.5 rounded-lg bg-brand-500 text-black font-semibold hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
          >
            Print / Save as PDF
          </button>
        </div>
      </div>

      {/* ── Report content ─────────────────────────────────────────────── */}
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-white print:text-black">{report.year} Savings Report</h1>
        <p className="text-sm text-white/60 print:text-black/60">Generated {new Date(report.generatedAt).toLocaleDateString(locale)}</p>
      </header>

      <section className="card p-4 mb-4 print:border print:border-black/20" aria-labelledby="totals-heading">
        <h2 id="totals-heading" className="text-sm font-semibold text-white/90 print:text-black mb-2">Totals</h2>
        <p className="text-3xl font-bold text-white print:text-black">{fmt(report.totalSaved)}</p>
        {report.percentChangeFromPreviousYear !== null && (
          <p className="text-sm text-white/60 print:text-black/70 mt-1">
            {report.percentChangeFromPreviousYear >= 0 ? "Up" : "Down"}{" "}
            {Math.abs(Math.round(report.percentChangeFromPreviousYear))}% vs {report.year - 1}
            {report.totalSavedPreviousYear !== null ? ` (${fmt(report.totalSavedPreviousYear)})` : ""}
          </p>
        )}
        <p className="text-sm text-white/60 print:text-black/70 mt-1">
          {report.depositCount} deposit{report.depositCount === 1 ? "" : "s"} · {report.goalsCompletedThisYear} goal{report.goalsCompletedThisYear === 1 ? "" : "s"} completed
        </p>
      </section>

      <section className="card p-4 mb-4 print:border print:border-black/20" aria-labelledby="monthly-heading">
        <h2 id="monthly-heading" className="text-sm font-semibold text-white/90 print:text-black mb-3">Month by month</h2>
        <table className="w-full text-sm">
          <caption className="sr-only">Total saved per month in {report.year}</caption>
          <thead>
            <tr className="text-left text-white/50 print:text-black/60">
              <th scope="col" className="font-normal pb-1">Month</th>
              <th scope="col" className="font-normal pb-1 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {report.monthlyBreakdown.map((m, i) => (
              <tr key={m.monthKey}>
                <td className="py-1 text-white/85 print:text-black">{MONTH_NAMES[i]}</td>
                <td className="py-1 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div
                      className="h-1.5 rounded-full bg-brand-500 print:hidden"
                      style={{ width: `${(m.total / maxMonthTotal) * 60}px` }}
                      role="presentation"
                    />
                    <span className="text-white/85 print:text-black tabular-nums">{fmt(m.total)}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {topCategories.length > 0 && (
        <section className="card p-4 mb-4 print:border print:border-black/20" aria-labelledby="category-heading">
          <h2 id="category-heading" className="text-sm font-semibold text-white/90 print:text-black mb-3">By category</h2>
          <ul className="space-y-2">
            {topCategories.map((c) => (
              <li key={c.categoryId} className="flex items-center justify-between text-sm">
                <span className="text-white/85 print:text-black">
                  <span aria-hidden="true">{c.icon} </span>{c.label}
                </span>
                <span className="text-white/60 print:text-black/70 tabular-nums">
                  {fmt(c.totalSaved)} ({Math.round(c.percentOfYearTotal)}%)
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.milestones.length > 0 && (
        <section className="card p-4 mb-4 print:border print:border-black/20" aria-labelledby="milestones-heading">
          <h2 id="milestones-heading" className="text-sm font-semibold text-white/90 print:text-black mb-3">Milestones this year</h2>
          <ul className="space-y-1.5">
            {report.milestones.map((h) => (
              <li key={h.id} className="text-sm text-white/85 print:text-black flex items-baseline justify-between gap-3">
                <span>{h.label}</span>
                <span className="text-white/50 print:text-black/60 whitespace-nowrap">
                  {new Date(h.timestamp).toLocaleDateString(locale)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Raw data exports — screen only ───────────────────────────────── */}
      <div className="print:hidden mt-6 pt-4 border-t border-white/10">
        <h2 className="text-sm font-semibold text-white/90 mb-2">Export raw data</h2>
        <div className="flex flex-wrap gap-3 text-sm">
          {[
            { label: "Monthly CSV", url: `/api/export/annual-report?year=${report.year}&format=csv&section=monthly`, filename: `savequest-monthly-${report.year}.csv` },
            { label: "Category CSV", url: `/api/export/annual-report?year=${report.year}&format=csv&section=category`, filename: `savequest-category-${report.year}.csv` },
            { label: "Milestones CSV", url: `/api/export/annual-report?year=${report.year}&format=csv&section=milestones`, filename: `savequest-milestones-${report.year}.csv` },
            { label: "All transactions CSV", url: "/api/export/transactions", filename: "savequest-transactions.csv" },
            { label: "All goals CSV", url: "/api/export/goals", filename: "savequest-goals.csv" },
          ].map((exp) => (
            <button
              key={exp.url}
              type="button"
              onClick={() => download(exp.url, exp.filename)}
              disabled={downloading === exp.url}
              className="text-brand-500 hover:underline disabled:opacity-50 disabled:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 rounded"
            >
              {downloading === exp.url ? "Preparing…" : exp.label}
            </button>
          ))}
        </div>
        {blocked && (
          <UpgradePrompt
            message={blocked.message}
            usageDetail={blocked.limit !== null && blocked.used !== null ? `${blocked.used} of ${blocked.limit} exports used this period` : undefined}
            onUpgradeClick={() => {
              clearBlocked();
              router.push("/settings/billing");
            }}
            className="mt-3"
          />
        )}
      </div>
    </div>
  );
}
