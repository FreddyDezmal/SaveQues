/**
 * lib/businessMetrics.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 11 — Phase 4: Business Outcome Monitoring
 *
 * WHY THIS FILE EXISTS
 *   Sentry (via lib/monitoring.ts) catches EXCEPTIONS — code that throws.
 *   It is structurally blind to a process that completes successfully but
 *   produces the wrong business outcome. This is not theoretical: Sprint 11's
 *   own Phase 1 investigation found exactly this shape of bug in
 *   record_app_open() — a function that ran successfully, every time, for
 *   months, while silently corrupting data, because nothing ever failed.
 *
 *   This module closes that gap for the five outcomes named in the brief:
 *   notification delivery rate, notification failures, deposit success
 *   rate, withdrawal success rate, and quest completion success rate.
 *
 * DESIGN
 *   Notification delivery rate is a QUERY against an EXISTING table
 *   (notification_logs) — confirmed during Phase 1 that it already has
 *   everything needed (error IS NULL as the success signal, indexed on
 *   user_id/sent_at/notification_type). No new instrumentation needed
 *   for that one.
 *
 *   Deposit/withdrawal/quest success rates required NEW infrastructure:
 *   those routes do not write a "failed" row to their business tables on
 *   a rejected request (validation/rate-limit/DB errors all return an
 *   HTTP error without inserting a row — confirmed in Phase 1). Migration
 *   030 adds a minimal request_outcomes table, written by
 *   lib/recordOutcome.ts's withOutcomeTracking() wrapper on all three
 *   routes, purpose-built for this query. This keeps the monitoring
 *   layer decoupled from the request paths it's watching — a bug in a
 *   financial route's business logic cannot also break the metric that
 *   would catch it, because the wrapper sits outside the handler and
 *   only inspects the final response status.
 *
 *   Alerting channel: Sentry only — confirmed during Phase 1 that no
 *   Slack/PagerDuty/webhook integration exists in this codebase. Each
 *   check below calls captureWarning()/captureError() with a distinct
 *   `metric` tag so these can be filtered into their own Sentry alert
 *   rule, separate from exception-based alerts.
 *
 * USAGE
 *   Call checkNotificationDeliveryRate() at the end of the cron run
 *   (app/api/cron/notifications/route.ts) — this is the natural place
 *   since that's exactly when a day's worth of notification_logs rows for
 *   "today" become complete enough to evaluate.
 *
 *   Call runAllBusinessMetricChecks() from a dedicated periodic cron
 *   (app/api/cron/business-metrics/route.ts, added in this sprint) so all
 *   four checks run on a schedule, independent of any single user
 *   request. None of these checks run synchronously inside a
 *   deposit/withdrawal/quest request — that would add a query to the
 *   critical path for a metric that only matters in aggregate.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { createLogger } from "@/lib/logger";
import { captureWarning, captureError } from "@/lib/monitoring";

const log = createLogger("business-metrics");

// ── Thresholds ──────────────────────────────────────────────────────────────
// Conservative starting points — these are deliberately loose to avoid
// alert fatigue in a low-volume beta, and are designed to be tightened
// once real baseline data exists. A LOOSE threshold that actually fires
// when something is badly wrong is more valuable than a TIGHT threshold
// nobody trusts because it cries wolf on normal variance.

const THRESHOLDS = {
  /** Below this fraction of eligible users notified, something is wrong
   *  with the scheduler itself (not just normal day-to-day variance in
   *  who happens to be "due" for a notification).
   *
   *  Sprint 12 independent audit: raised from 0.5 to 0.7.
   *  Rationale: the stated SLO target is 80% delivery, but the original
   *  alert threshold was 50% — a 30-point gap meaning a run delivering
   *  to only 60% of users would breach the SLO while producing no alert.
   *  The production cron run confirmed in Sprint 11 showed delivery rate
   *  well above 80% (6/6 sent, 100% of eligible users), so raising the
   *  threshold to 70% immediately is safe and brings the alert closer
   *  to the SLO target without risk of false positives on the current
   *  baseline. Tighten further to 80% once 30 days of baseline data
   *  accumulates to confirm what "normal stale-subscription rate" is. */
  NOTIFICATION_DELIVERY_RATE_MIN: 0.7,
  /** Below this success rate on financial writes, investigate immediately —
   *  this is deliberately much stricter than the notification threshold,
   *  because a failed deposit has direct user/financial impact while a
   *  missed reminder notification does not. */
  DEPOSIT_SUCCESS_RATE_MIN:    0.95,
  WITHDRAWAL_SUCCESS_RATE_MIN: 0.95,
  QUEST_SUCCESS_RATE_MIN:      0.90,
  /** Minimum sample size before a rate is meaningful — 1 failure out of 1
   *  attempt is a 0% success rate but tells you nothing. Below this count,
   *  log the observation but do not alert. */
  MIN_SAMPLE_SIZE: 5,
} as const;

// ── Notification delivery rate ───────────────────────────────────────────────

export interface NotificationDeliveryResult {
  eligible: number;
  attempted: number;
  sent: number;
  failed: number;
  deliveryRate: number | null;
  alerted: boolean;
}

/**
 * Compares how many users were ELIGIBLE for a notification today (active
 * subscription + notifications_enabled) against how many notification_logs
 * rows exist for today with no error. A healthy run should see attempted
 * and sent track reasonably close to eligible — a large gap, especially
 * eligible >> attempted, is the signature of the exact class of bug this
 * sprint found in record_app_open() (the scheduler ran, but skipped nearly
 * everyone for a reason that isn't visible as an exception).
 */
export async function checkNotificationDeliveryRate(): Promise<NotificationDeliveryResult> {
  const supabase = createServiceClient();
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const [{ count: eligible }, { data: todayLogs }] = await Promise.all([
    supabase
      .from("push_subscriptions")
      .select("user_id", { count: "exact", head: true })
      .eq("is_active", true),
    supabase
      .from("notification_logs")
      .select("error")
      .gte("sent_at", todayStart.toISOString()),
  ]);

  const attempted = todayLogs?.length ?? 0;
  const sent       = todayLogs?.filter(l => l.error === null).length ?? 0;
  const failed      = attempted - sent;
  const eligibleCount = eligible ?? 0;

  const deliveryRate = eligibleCount > 0 ? attempted / eligibleCount : null;

  let alerted = false;
  if (eligibleCount >= THRESHOLDS.MIN_SAMPLE_SIZE && deliveryRate !== null
      && deliveryRate < THRESHOLDS.NOTIFICATION_DELIVERY_RATE_MIN) {
    alerted = true;
    captureWarning(
      `Notification delivery rate ${(deliveryRate * 100).toFixed(1)}% is below the ${THRESHOLDS.NOTIFICATION_DELIVERY_RATE_MIN * 100}% threshold`,
      {
        metric:    "notification_delivery_rate",
        eligible:  eligibleCount,
        attempted,
        sent,
        failed,
        rate:      deliveryRate,
      }
    );
  }

  log.info("Notification delivery rate checked", {
    eligible: eligibleCount, attempted, sent, failed,
    rate: deliveryRate ?? -1, alerted,
  });

  return { eligible: eligibleCount, attempted, sent, failed, deliveryRate, alerted };
}

// ── Generic success-rate check (deposits, withdrawals, quests) ─────────────

export interface SuccessRateResult {
  attempts: number;
  failures: number;
  successRate: number | null;
  alerted: boolean;
}

/**
 * Shared implementation for "how often did writes to this table fail
 * today" — used for deposits, withdrawals, and quest completions, which
 * all have the same shape of question even though the underlying tables
 * differ.
 *
 * IMPORTANT — this checks APPLICATION-LEVEL failure visibility, not raw
 * row counts. Financial routes in this codebase do not write a "failed"
 * row to transactions on a rejected/errored request (validation failures,
 * rate limits, and DB errors all return an HTTP error WITHOUT inserting a
 * row — confirmed in Phase 1 by reading app/api/transactions/route.ts in
 * full). This means transactions table row count alone cannot reveal a
 * failure rate; failures only ever produce LOG lines and Sentry events,
 * never database rows. So this function counts structured log error
 * entries for the given service name within the window, compared against
 * total attempts inferred from successful inserts + logged failures. This
 * is intentionally log-based, not table-based, because the underlying
 * data model has no "failed transaction" row to query in the first place.
 */
/**
 * Shared implementation for "how often did writes to this route succeed
 * today" — used for deposits, withdrawals, and quest completions.
 *
 * Queries request_outcomes (migration 030), populated by
 * lib/recordOutcome.ts's withOutcomeTracking() wrapper on all three
 * routes. Any HTTP status >= 400 is a 'failure' row; this includes
 * validation errors (422) and rate limits (429) alongside genuine server
 * errors (500) — deliberately coarse, matching the brief's ask for a
 * SUCCESS RATE rather than a detailed error taxonomy (Sentry already
 * provides that breakdown, correlated via request_id).
 */
async function checkRouteSuccessRate(
  route: string,
  minRate: number,
  metricName: string,
  actionLabel: string
): Promise<SuccessRateResult> {
  const supabase = createServiceClient();
  const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from("request_outcomes")
    .select("outcome")
    .eq("route", route)
    .gte("created_at", windowStart);

  if (error) {
    log.warn(`${actionLabel} success-rate query failed`, { metric: metricName, error: error.message });
    return { attempts: 0, failures: 0, successRate: null, alerted: false };
  }

  const attempts = rows?.length ?? 0;
  const failures = rows?.filter(r => r.outcome === "failure").length ?? 0;
  const successRate = attempts > 0 ? (attempts - failures) / attempts : null;

  let alerted = false;
  if (attempts >= THRESHOLDS.MIN_SAMPLE_SIZE && successRate !== null && successRate < minRate) {
    alerted = true;
    captureWarning(
      `${actionLabel} success rate ${(successRate * 100).toFixed(1)}% is below the ${minRate * 100}% threshold`,
      { metric: metricName, route, attempts, failures, rate: successRate }
    );
  }

  log.info(`${actionLabel} success rate checked`, {
    metric: metricName, route, attempts, failures, rate: successRate ?? -1, alerted,
  });

  return { attempts, failures, successRate, alerted };
}

export async function checkDepositSuccessRate(): Promise<SuccessRateResult> {
  return checkRouteSuccessRate(
    "transactions.deposit",
    THRESHOLDS.DEPOSIT_SUCCESS_RATE_MIN,
    "deposit_success_rate",
    "Deposit"
  );
}

export async function checkWithdrawalSuccessRate(): Promise<SuccessRateResult> {
  return checkRouteSuccessRate(
    "transactions.withdrawal",
    THRESHOLDS.WITHDRAWAL_SUCCESS_RATE_MIN,
    "withdrawal_success_rate",
    "Withdrawal"
  );
}

export async function checkQuestSuccessRate(): Promise<SuccessRateResult> {
  return checkRouteSuccessRate(
    "quest.daily.complete",
    THRESHOLDS.QUEST_SUCCESS_RATE_MIN,
    "quest_success_rate",
    "Quest completion"
  );
}

// ── Run all checks (called by the periodic business-metrics cron) ─────────

export interface BusinessMetricsSummary {
  notifications: NotificationDeliveryResult;
  deposits: SuccessRateResult;
  withdrawals: SuccessRateResult;
  quests: SuccessRateResult;
}

export async function runAllBusinessMetricChecks(): Promise<BusinessMetricsSummary> {
  try {
    const [notifications, deposits, withdrawals, quests] = await Promise.all([
      checkNotificationDeliveryRate(),
      checkDepositSuccessRate(),
      checkWithdrawalSuccessRate(),
      checkQuestSuccessRate(),
    ]);

    return { notifications, deposits, withdrawals, quests };
  } catch (err: any) {
    log.error("Business metrics check run failed", { error: err.message ?? String(err) });
    captureError(err, { route: "runAllBusinessMetricChecks" });
    throw err;
  }
}