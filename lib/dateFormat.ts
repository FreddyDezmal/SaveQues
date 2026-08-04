/**
 * lib/dateFormat.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 31 — Phase 12: Localization Readiness.
 *
 * Distinct from lib/dateUtils.ts on purpose: dateUtils.ts is about WHICH
 * calendar date something is (a data-integrity concern — activity_log
 * writes/reads agreeing on "today"). This file is about how a date is
 * DISPLAYED to a person — a UI-formatting concern, same category as
 * lib/currency.ts's formatAmount. The two should never be merged: mixing
 * "what date is this" logic with "how do we show it" logic is exactly
 * the kind of blending Phase 12 asks to avoid.
 *
 * AUDIT FINDING this file fixes: before this phase, ~15 components each
 * called `new Date(x).toLocaleDateString(...)` directly, with locale
 * handling that was inconsistent in three different ways — hardcoded to
 * the wrong thing ("en-ZA" in goals/new/page.tsx, "en-US" in
 * DigestClient.tsx, "en" in EventsClient.tsx/QuestsClient.tsx — all
 * wrong for a non-ZAR/non-US/non-English-default user), left as the
 * browser's own runtime default (BillingClient.tsx, InvitesClient.tsx,
 * GroupQuestCard.tsx — inconsistent between server and client rendering,
 * and unrelated to the user's actual chosen locale), or — in the two
 * report clients — already correctly using the real user locale, just
 * with the formatting options re-typed at every call site instead of
 * shared.
 *
 * Fix: every date-formatting call site now goes through one of the
 * functions below, which all default to DEFAULT_LOCALE (this app's
 * historical de facto locale — see lib/currency.ts's own DEFAULT_LOCALE
 * for why that's the correct, zero-regression default rather than
 * something like "en-US") and accept the real user locale as an
 * optional override wherever a caller already has it in scope.
 *
 * HONEST LIMITATION (documented per the sprint's "known limitations, be
 * honest" principle, not silently left as a gap): components that don't
 * currently receive the viewing user's locale as a prop at all
 * (ScenarioSimulatorCard, GoalIntelligenceCard, PortfolioIntelligenceCard,
 * ActivityFeedCard, ContributionCard, GroupQuestCard, QuestsClient,
 * EventsClient, InvitesClient, BillingClient) now render dates
 * consistently in DEFAULT_LOCALE rather than each other's differing,
 * uncoordinated defaults — a real improvement — but NOT yet in each
 * individual viewer's own chosen locale, since that would require
 * threading a new `locale` prop through each of those components' call
 * chains, which is genuinely new plumbing work, not a formatting fix.
 * Deferred as explicit future work rather than bundled into this phase.
 */

import { DEFAULT_LOCALE } from "@/lib/currency";

/**
 * "15 Mar 2026" — day, short month, year. For content where the year
 * matters (goal target dates, report timestamps, historical entries).
 */
export function formatDateLong(date: Date | string, locale: string = DEFAULT_LOCALE): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * "15 Mar" — short month, day, no year. For compact UI where the
 * current year is implied (activity feeds, quest end dates, timestamps
 * on things that happened recently).
 */
export function formatDateShort(date: Date | string, locale: string = DEFAULT_LOCALE): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

/**
 * The locale's own native numeric date format (e.g. "2026/03/15" for
 * en-ZA, "3/15/2026" for en-US) — no explicit options, matching what
 * every "no options passed" call site was already visually going for,
 * just now with a consistent, intentional locale instead of an
 * uncoordinated runtime default.
 */
export function formatDateNumeric(date: Date | string, locale: string = DEFAULT_LOCALE): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(locale);
}
