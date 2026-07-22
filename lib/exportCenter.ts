/**
 * lib/exportCenter.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 24 — Phase 11: Export Centre.
 *
 * Audit note before writing this: grepped for any existing CSV/PDF/
 * export code (lib/, app/api/) — there is none. package.json has no
 * PDF library (only @playwright/test as a dev/test dependency, not
 * meant for runtime PDF generation in a serverless function). This is
 * genuinely new infrastructure — see the PDF note near the bottom of
 * this file for how that gap is handled honestly rather than faked.
 *
 * WHY buildAnnualReport() DOESN'T REUSE lib/monthlyReport.ts DIRECTLY
 *   buildMonthlyReport() was designed (Sprint 20) to answer "how is
 *   this user doing *right now*, this month" — its goalHealthSummary/
 *   forecastSummary/coachingSummary fields are deliberately computed
 *   against `goal.current_amount` and `now`, i.e. today's real balance
 *   and today's real pace. Calling it once per historical month with a
 *   backdated `now` would silently mislabel today's goal balance and
 *   today's pace as if they belonged to March, say — a real, misleading
 *   inaccuracy, not just an unused field. So an annual report is built
 *   here from the same lower-level, genuinely historical primitives
 *   monthlyReport.ts itself is built on (getDeposits, monthlyTotals),
 *   plus buildJourneyHighlights() for milestones — never buildMonthlyReport()
 *   itself. This is a deviation from "just call the existing report
 *   function," and it's deliberate — documenting per this codebase's
 *   own engineering standard to "explain deviations from the brief."
 *
 * WHY THE CATEGORY BREAKDOWN HERE IS ITS OWN SMALL FUNCTION, NOT A CALL
 * TO lib/categoryIntelligence.ts's computeCategoryIntelligence()
 *   computeCategoryIntelligence() is whole-history and today-relative by
 *   design (its likelyStalledCount depends on "days since the most
 *   recent deposit on this goal ever", not "within this year"). Pre-filtering
 *   its `transactions` input to one calendar year to get a year-scoped
 *   total would silently corrupt that stalled-goal calculation for any
 *   goal with real activity outside the filtered year. categoryTotalsForYear()
 *   below answers a narrower, genuinely year-scoped question ("how much
 *   was saved in each category during this specific year") without
 *   touching the stalled-goal logic at all.
 */

import type { SavingsGoal, Transaction, Profile } from "@/lib/types";
import { getDeposits, monthlyTotals, getGoalCompletionTimestamp } from "@/lib/analyticsEngine";
import { buildJourneyHighlights, type JourneyHighlight } from "@/lib/journeyHighlights";
import { GOAL_CATEGORIES, type GoalCategory } from "@/lib/utils";

// ── Generic CSV builder ──────────────────────────────────────────────────

export interface CSVColumn<T> {
  header: string;
  /** Extracts and formats this column's value for one row. Must return a string (caller decides formatting — currency, dates, etc). */
  value: (row: T) => string;
}

/**
 * RFC 4180-ish CSV: fields containing a comma, quote, or newline are
 * quoted, with internal quotes doubled. Spreadsheet apps (Excel, Google
 * Sheets, Numbers) all read this correctly — this is the one part of
 * "export" that's genuinely universal, unlike PDF rendering.
 */
function escapeCSVField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCSV<T>(rows: T[], columns: CSVColumn<T>[]): string {
  const header = columns.map((c) => escapeCSVField(c.header)).join(",");
  const lines = rows.map((row) => columns.map((c) => escapeCSVField(c.value(row))).join(","));
  // CRLF line endings — the CSV spec's own recommendation, and what
  // Excel expects for reliable cross-platform opening.
  return [header, ...lines].join("\r\n");
}

// ── Transaction / goal exports ───────────────────────────────────────────

export function transactionsToCSV(transactions: Transaction[], goals: Pick<SavingsGoal, "id" | "title" | "category">[]): string {
  const goalById = new Map(goals.map((g) => [g.id, g]));
  const sorted = [...transactions].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return toCSV(sorted, [
    { header: "Date",         value: (t) => t.created_at },
    { header: "Type",         value: (t) => t.transaction_type },
    { header: "Amount",       value: (t) => String(Number(t.amount)) },
    { header: "Goal",         value: (t) => goalById.get(t.goal_id)?.title ?? "(deleted goal)" },
    { header: "Category",     value: (t) => goalById.get(t.goal_id)?.category ?? "" },
    { header: "Note",         value: (t) => t.note ?? "" },
  ]);
}

export function goalsToCSV(goals: SavingsGoal[]): string {
  return toCSV(goals, [
    { header: "Title",          value: (g) => g.title },
    { header: "Category",       value: (g) => g.category },
    { header: "Target amount",  value: (g) => String(Number(g.target_amount)) },
    { header: "Current amount", value: (g) => String(Number(g.current_amount)) },
    { header: "Progress (%)",   value: (g) => String(Number(g.target_amount) > 0 ? Math.round((Number(g.current_amount) / Number(g.target_amount)) * 100) : 0) },
    { header: "Target date",    value: (g) => g.target_date ?? "" },
    { header: "Complete",       value: (g) => (g.is_complete ? "Yes" : "No") },
    { header: "Created",        value: (g) => g.created_at },
  ]);
}

// ── Annual report ─────────────────────────────────────────────────────────

export interface AnnualCategoryTotal {
  categoryId: GoalCategory;
  label: string;
  icon: string;
  color: string;
  totalSaved: number;
  percentOfYearTotal: number;
}

export interface AnnualReport {
  year: number;
  totalSaved: number;
  depositCount: number;
  totalSavedPreviousYear: number | null;
  percentChangeFromPreviousYear: number | null;
  /** All 12 months, zero-filled — a month with no deposits still appears with total: 0. */
  monthlyBreakdown: { monthKey: string; total: number; count: number }[];
  categoryBreakdown: AnnualCategoryTotal[];
  /** Goals whose (proxy) completion timestamp — see getGoalCompletionTimestamp — falls within this year. */
  goalsCompletedThisYear: number;
  /** Journey highlights (lib/journeyHighlights.ts) that fell within this year, oldest → newest. */
  milestones: JourneyHighlight[];
  generatedAt: string;
}

/** Sums deposits into each category's goals, restricted to deposits made in `year`. See file header for why this doesn't call computeCategoryIntelligence(). */
function categoryTotalsForYear(
  goals: Pick<SavingsGoal, "id" | "category">[],
  transactions: Transaction[],
  year: number
): AnnualCategoryTotal[] {
  const deposits = getDeposits(transactions).filter((d) => new Date(d.created_at).getUTCFullYear() === year);
  const yearTotal = deposits.reduce((s, d) => s + Number(d.amount), 0);

  return GOAL_CATEGORIES.map((catDef) => {
    const goalIds = new Set(goals.filter((g) => g.category === catDef.id).map((g) => g.id));
    const totalSaved = deposits.filter((d) => goalIds.has(d.goal_id)).reduce((s, d) => s + Number(d.amount), 0);
    return {
      categoryId: catDef.id,
      label: catDef.label,
      icon: catDef.icon,
      color: catDef.color,
      totalSaved,
      percentOfYearTotal: yearTotal > 0 ? (totalSaved / yearTotal) * 100 : 0,
    };
  });
}

export interface AnnualReportInputs {
  profile: Pick<Profile, "created_at" | "xp_total">;
  goals: SavingsGoal[];
  transactions: Transaction[];
  year: number;
  now?: Date;
}

/** Pure, deterministic — no AI, matching the Phase 5/11 "no AI, generate deterministic summaries" rule from the sprint brief. */
export function buildAnnualReport({ profile, goals, transactions, year, now = new Date() }: AnnualReportInputs): AnnualReport {
  const deposits = getDeposits(transactions);
  const yearDeposits = deposits.filter((d) => new Date(d.created_at).getUTCFullYear() === year);
  const prevYearDeposits = deposits.filter((d) => new Date(d.created_at).getUTCFullYear() === year - 1);

  const totalSaved = yearDeposits.reduce((s, d) => s + Number(d.amount), 0);
  const totalSavedPreviousYear = prevYearDeposits.length > 0
    ? prevYearDeposits.reduce((s, d) => s + Number(d.amount), 0)
    : null;
  const percentChangeFromPreviousYear =
    totalSavedPreviousYear === null || totalSavedPreviousYear === 0
      ? null
      : ((totalSaved - totalSavedPreviousYear) / totalSavedPreviousYear) * 100;

  // Zero-fill all 12 months so a quiet month shows as 0, not a gap.
  const totalsByMonth = new Map(monthlyTotals(yearDeposits).map((b) => [b.key, b]));
  const monthlyBreakdown = Array.from({ length: 12 }, (_, i) => {
    const monthKey = `${year}-${String(i + 1).padStart(2, "0")}`;
    const bucket = totalsByMonth.get(monthKey);
    return { monthKey, total: bucket?.total ?? 0, count: bucket?.count ?? 0 };
  });

  const goalsCompletedThisYear = goals.filter(
    (g) => g.is_complete && new Date(getGoalCompletionTimestamp(g, transactions)).getUTCFullYear() === year
  ).length;

  const milestones = buildJourneyHighlights({ profile, goals, transactions }).filter(
    (h) => new Date(h.timestamp).getUTCFullYear() === year
  );

  return {
    year,
    totalSaved,
    depositCount: yearDeposits.length,
    totalSavedPreviousYear,
    percentChangeFromPreviousYear,
    monthlyBreakdown,
    categoryBreakdown: categoryTotalsForYear(goals, transactions, year),
    goalsCompletedThisYear,
    milestones,
    generatedAt: now.toISOString(),
  };
}

export function annualReportMonthlyToCSV(report: AnnualReport): string {
  return toCSV(report.monthlyBreakdown, [
    { header: "Month",    value: (m) => m.monthKey },
    { header: "Total saved", value: (m) => String(m.total) },
    { header: "Deposits", value: (m) => String(m.count) },
  ]);
}

export function annualReportCategoryToCSV(report: AnnualReport): string {
  return toCSV(report.categoryBreakdown, [
    { header: "Category",       value: (c) => c.label },
    { header: "Total saved",    value: (c) => String(c.totalSaved) },
    { header: "% of year total", value: (c) => String(Math.round(c.percentOfYearTotal * 10) / 10) },
  ]);
}

export function milestonesToCSV(highlights: JourneyHighlight[]): string {
  return toCSV(highlights, [
    { header: "Date",  value: (h) => h.timestamp },
    { header: "Milestone", value: (h) => h.label },
  ]);
}

// ── PDF export — HONEST LIMITATION, NOT IMPLEMENTED ────────────────────────
// The Sprint 24 brief asks for PDF export. There is no PDF-generation
// library anywhere in this codebase (checked package.json — only
// @playwright/test, a dev/test-only dependency, not something this app
// should spin up inside a request-serving serverless function). Faking
// a "PDF" by mislabeling a CSV or HTML response, or hand-rolling a raw
// PDF byte stream with no way to visually verify it renders correctly
// in this sandbox, would both violate this codebase's own "never claim
// a calculation/output is correct without verifying it" standard.
//
// What ships instead: app/(app)/reports/annual/page.tsx, a print-optimised
// view of the exact same buildAnnualReport() data, styled with @media
// print rules so a user's browser "Print → Save as PDF" produces a real,
// correctly laid-out PDF today with zero new dependencies. True
// server-generated binary PDF (for emailing a report, say — a real
// Premium-feature candidate per the brief's own "Future Premium features
// may extend this system" note) is a legitimate follow-up: add a
// PDF-rendering dependency (e.g. @react-pdf/renderer, which needs no
// headless browser) as its own reviewable change, with real output
// verified before it ships — not bundled into this change where it
// can't be verified.
