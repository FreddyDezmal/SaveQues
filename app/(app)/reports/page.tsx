/**
 * app/(app)/reports/page.tsx
 * ─────────────────────────────────────────────────────────────
 * Sprint 30 — Phase 5: Premium Reports — reports hub.
 *
 * AUDIT NOTE: app/(app)/reports/annual existed before this sprint but
 * had no link to it anywhere in the app (confirmed by grep — the only
 * way to reach it was typing the URL directly). This page, plus the new
 * Monthly report, finally get a real entry point.
 */

import Link from "next/link";

const REPORTS = [
  { href: "/reports/monthly", emoji: "🗓️", title: "Monthly report", description: "This month's savings, goal health, and coaching, generated fresh." },
  { href: "/reports/annual", emoji: "📅", title: "Annual report", description: "A full year's savings, category breakdown, and milestones." },
];

export default function ReportsPage() {
  return (
    <div className="p-4 pb-24 max-w-lg mx-auto">
      <h1 className="font-display text-xl font-bold text-white mb-1">Reports</h1>
      <p className="text-xs text-white/45 mb-4">View on-screen and print to PDF, or download the underlying data as CSV from within each report.</p>
      <div className="space-y-2">
        {REPORTS.map((r) => (
          <Link
            key={r.href}
            href={r.href}
            className="flex items-center gap-3 card p-4 hover:bg-white/[0.03] transition-colors"
          >
            <span className="text-2xl" aria-hidden>{r.emoji}</span>
            <div className="flex-1">
              <p className="text-sm font-medium text-white/90">{r.title}</p>
              <p className="text-xs text-white/50 mt-0.5">{r.description}</p>
            </div>
            <span aria-hidden className="text-white/30">→</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
