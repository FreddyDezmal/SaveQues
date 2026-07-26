/**
 * lib/notificationAnalytics.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 27, Phase 11 — Notification Analytics.
 *
 * Pure computation, same separation-of-concerns pattern as
 * lib/reminderEngine.ts / lib/digest.ts: callers (the admin metrics API
 * route) fetch raw notification_logs rows and pass them in here; this
 * file turns them into the "Delivered, Opened, Dismissed, Clicked,
 * Converted, Ignored" breakdown the brief asks for, plus rates, both
 * overall and per notification type — the shared reporting hook a
 * future dashboard (in-app admin panel today, anything else later)
 * calls through.
 *
 * TERMINOLOGY MAPPING — worth stating explicitly, not left implicit:
 *   Delivered → row.delivered_at set (shown by the OS/browser)
 *   Clicked   → row.clicked_at set (tapped from the OS notification)
 *   Opened    → row.read_at set (viewed within the in-app Notification
 *               Center inbox — Sprint 15's existing read state, reused
 *               under the brief's "Opened" name rather than duplicated
 *               as a second column meaning the same thing)
 *   Dismissed → row.dismissed_at set (closed without acting — see
 *               public/sw.js for the two ways this gets recorded)
 *   Converted → row.converted_at set (the underlying action actually
 *               happened — see lib/notificationAttribution.ts)
 *   Ignored   → COMPUTED, not a column: delivered, but none of
 *               clicked/read/dismissed/converted ever happened.
 */

export interface NotificationLogRow {
  notification_type: string;
  sent_at: string;
  delivered_at: string | null;
  clicked_at: string | null;
  read_at: string | null;
  dismissed_at: string | null;
  converted_at: string | null;
}

export interface EngagementCounts {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  dismissed: number;
  converted: number;
  ignored: number;
}

export interface EngagementRates {
  delivery_rate: string;
  open_rate: string;
  click_rate: string;
  dismiss_rate: string;
  conversion_rate: string;
  ignored_rate: string;
}

export type EngagementBreakdown = EngagementCounts & EngagementRates;

/** Formats a 0-1 fraction as a fixed-one-decimal percentage string, safe
 *  against a zero denominator (returns "0" rather than NaN/Infinity). */
function pct(numerator: number, denominator: number): string {
  if (denominator <= 0) return "0";
  return ((numerator / denominator) * 100).toFixed(1);
}

function isIgnored(row: NotificationLogRow): boolean {
  return !!row.delivered_at && !row.clicked_at && !row.read_at && !row.dismissed_at && !row.converted_at;
}

export function countEngagement(rows: NotificationLogRow[]): EngagementCounts {
  return {
    sent: rows.length,
    delivered: rows.filter((r) => r.delivered_at).length,
    opened: rows.filter((r) => r.read_at).length,
    clicked: rows.filter((r) => r.clicked_at).length,
    dismissed: rows.filter((r) => r.dismissed_at).length,
    converted: rows.filter((r) => r.converted_at).length,
    ignored: rows.filter(isIgnored).length,
  };
}

/**
 * Rates are each expressed against the denominator that makes the
 * number meaningful, not uniformly against `sent` — e.g. click rate
 * against `delivered` (you can't click what never showed), conversion
 * rate against `clicked` (conversion is defined as following through on
 * a click, not a coincidental deposit with no notification interaction
 * at all — see lib/notificationAttribution.ts). Ignored rate is the one
 * exception, deliberately against `delivered`, since "ignored" is only
 * a meaningful category for things that were actually shown.
 */
export function computeEngagementRates(counts: EngagementCounts): EngagementRates {
  return {
    delivery_rate: pct(counts.delivered, counts.sent),
    open_rate: pct(counts.opened, counts.delivered),
    click_rate: pct(counts.clicked, counts.delivered),
    dismiss_rate: pct(counts.dismissed, counts.delivered),
    conversion_rate: pct(counts.converted, counts.clicked),
    ignored_rate: pct(counts.ignored, counts.delivered),
  };
}

export function computeEngagementBreakdown(rows: NotificationLogRow[]): EngagementBreakdown {
  const counts = countEngagement(rows);
  return { ...counts, ...computeEngagementRates(counts) };
}

export interface TypeBreakdown extends EngagementBreakdown {
  type: string;
}

/** Same breakdown, grouped by notification_type — the "by_type" section
 *  of the admin metrics response. */
export function computeEngagementByType(rows: NotificationLogRow[]): TypeBreakdown[] {
  const byType = new Map<string, NotificationLogRow[]>();
  for (const row of rows) {
    const list = byType.get(row.notification_type) ?? [];
    list.push(row);
    byType.set(row.notification_type, list);
  }
  return Array.from(byType.entries()).map(([type, typeRows]) => ({
    type,
    ...computeEngagementBreakdown(typeRows),
  }));
}
