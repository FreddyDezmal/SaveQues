/**
 * lib/habitCalendar.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 21 — Phase 7: Habit Calendar Engine.
 *
 * Builds on lib/heatmap.ts (Sprint 20) — reuses its day-level cell data
 * rather than re-deriving daily deposit totals — and adds the calendar-
 * level aggregates heatmap.ts didn't need: streak runs, inactive runs,
 * strongest weeks/months, and clusters of consecutive high-activity days.
 * UI-independent, per the brief: this returns data only, no chart/grid
 * component is built here (see docs/SPRINT21_BEHAVIOR.md for that
 * follow-up).
 */

import { buildSavingsHeatmap, type HeatmapCell, type HeatmapRange } from "@/lib/heatmap";
import { getUTCWeekStartString, getUTCMonthString } from "@/lib/dateUtils";
import type { Transaction } from "@/lib/types";

export interface DayRun {
  startDate: string;
  endDate: string;
  lengthDays: number;
}

export interface PeriodTotal {
  key: string; // week-start date, or "YYYY-MM"
  total: number;
}

export interface HabitCalendar {
  range: HeatmapRange;
  cells: HeatmapCell[];
  activeDayStreaks: DayRun[];
  longestActiveDayStreak: DayRun | null;
  inactiveDayRuns: DayRun[];
  longestInactiveDayRun: DayRun | null;
  strongestWeek: PeriodTotal | null;
  strongestMonth: PeriodTotal | null;
  /** Runs of 3+ consecutive days at heatmap level >=3 ("high"/"very high") — the visually-clustered parts of the calendar. */
  consistencyClusters: DayRun[];
}

function findRuns(cells: HeatmapCell[], predicate: (c: HeatmapCell) => boolean): DayRun[] {
  const runs: DayRun[] = [];
  let start: string | null = null;
  let prevDate: string | null = null;
  let length = 0;

  for (const cell of cells) {
    if (predicate(cell)) {
      if (start === null) {
        start = cell.date;
        length = 1;
      } else {
        length += 1;
      }
      prevDate = cell.date;
    } else if (start !== null) {
      runs.push({ startDate: start, endDate: prevDate!, lengthDays: length });
      start = null;
      length = 0;
    }
  }
  if (start !== null) runs.push({ startDate: start, endDate: prevDate!, lengthDays: length });
  return runs;
}

export function buildHabitCalendar(
  transactions: Transaction[],
  range: HeatmapRange = "quarter",
  now: Date = new Date()
): HabitCalendar {
  const cells = buildSavingsHeatmap(transactions, range, now);

  const activeDayStreaks = findRuns(cells, (c) => c.level > 0);
  const inactiveDayRuns = findRuns(cells, (c) => c.level === 0);
  const consistencyClusters = findRuns(cells, (c) => c.level >= 3).filter((r) => r.lengthDays >= 3);

  const longestActiveDayStreak = activeDayStreaks.reduce<DayRun | null>(
    (best, r) => (!best || r.lengthDays > best.lengthDays ? r : best),
    null
  );
  const longestInactiveDayRun = inactiveDayRuns.reduce<DayRun | null>(
    (best, r) => (!best || r.lengthDays > best.lengthDays ? r : best),
    null
  );

  const weekTotals = new Map<string, number>();
  const monthTotals = new Map<string, number>();
  for (const cell of cells) {
    if (cell.amount <= 0) continue;
    const date = new Date(cell.date + "T00:00:00Z");
    const weekKey = getUTCWeekStartString(date);
    const monthKey = getUTCMonthString(date);
    weekTotals.set(weekKey, (weekTotals.get(weekKey) ?? 0) + cell.amount);
    monthTotals.set(monthKey, (monthTotals.get(monthKey) ?? 0) + cell.amount);
  }

  let strongestWeek: PeriodTotal | null = null;
  for (const [key, total] of Array.from(weekTotals.entries())) {
    if (!strongestWeek || total > strongestWeek.total) strongestWeek = { key, total };
  }
  let strongestMonth: PeriodTotal | null = null;
  for (const [key, total] of Array.from(monthTotals.entries())) {
    if (!strongestMonth || total > strongestMonth.total) strongestMonth = { key, total };
  }

  return {
    range,
    cells,
    activeDayStreaks,
    longestActiveDayStreak,
    inactiveDayRuns,
    longestInactiveDayRun,
    strongestWeek,
    strongestMonth,
    consistencyClusters,
  };
}
