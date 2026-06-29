/**
 * lib/businessMetrics.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 13 P0-C: Raised financial alert thresholds to align with SLOs.
 *
 * CHANGE: DEPOSIT_SUCCESS_RATE_MIN and WITHDRAWAL_SUCCESS_RATE_MIN raised
 * from 0.95 to 0.99. Previously a 4.5% failure rate — nearly 1 in 20
 * deposits — would go undetected. Financial SLOs target 99.5% success;
 * alerting at 99% gives a 0.5% headroom for investigation before breach.
 *
 * Sprint 13 P2-A: Added checkDashboardP95() to measure dashboard latency
 * SLO from real timing data (migration 036).
 */

import { createServiceClient } from "@/lib/supabase/server";
import { createLogger }        from "@/lib/logger";
import { captureWarning }      from "@/lib/monitoring";

const log = createLogger("business-metrics");

// ── Alert thresholds ──────────────────────────────────────────────────────────
// IMPORTANT: these must be set BELOW the SLO target to give response time.
// Example: SLO = 99.5% → alert at 99% → 0.5% headroom before SLO breach.
const THRESHOLDS = {
  // Financial routes — raised from 0.95 to 0.99 (Sprint 13 P0-C)
  // SLO target: 99.5%. Alert at 99% = 0.5% investigation headroom.
  DEPOSIT_SUCCESS_RATE_MIN:    0.99,
  WITHDRAWAL_SUCCESS_RATE_MIN: 0.99,

  // Quest completion — raised from 0.90 to 0.95
  // SLO target: 99%. Alert at 95% = 4% headroom (quest failure is non-financial).
  QUEST_SUCCESS_RATE_MIN:      0.95,

  // Notification delivery — kept at 0.70 pending 30-day baseline
  // SLO target: 80%. Raise to 0.75 once normal stale-subscription rate confirmed.
  NOTIFICATION_DELIVERY_RATE_MIN: 0.70,

  // Dashboard P95 latency — alert at 3000ms (SLO: < 2000ms P95)
  // Headroom allows investigation before SLO breach. Raised from 2000ms
  // to avoid false positives during cold starts.
  DASHBOARD_P95_MAX_MS: 3000,

  // Minimum sample size — prevents false positives at low request volume.
  // Below this count, rate calculations are statistically unreliable.
  MIN_SAMPLE_SIZE: 5,
} as const;

// ── Success rate checks ───────────────────────────────────────────────────────

export async function checkDepositSuccessRate(): Promise<void> {
  const serviceClient = createServiceClient();
  const windowStart   = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour

  const { data, error } = await serviceClient
    .from("request_outcomes")
    .select("outcome")
    .eq("route", "deposit")
    .gte("created_at", windowStart);

  if (error || !data) {
    log.warn("Failed to fetch deposit outcomes", { error: error?.message });
    return;
  }

  if (data.length < THRESHOLDS.MIN_SAMPLE_SIZE) return;

  const successRate = data.filter(r => r.outcome === "success").length / data.length;

  log.info("Deposit success rate", {
    rate:    successRate,
    samples: data.length,
    threshold: THRESHOLDS.DEPOSIT_SUCCESS_RATE_MIN,
  });

  if (successRate < THRESHOLDS.DEPOSIT_SUCCESS_RATE_MIN) {
    captureWarning("Deposit success rate below threshold", {
      rate:      String(successRate.toFixed(4)),
      samples:   String(data.length),
      threshold: String(THRESHOLDS.DEPOSIT_SUCCESS_RATE_MIN),
    });
  }
}

export async function checkWithdrawalSuccessRate(): Promise<void> {
  const serviceClient = createServiceClient();
  const windowStart   = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data, error } = await serviceClient
    .from("request_outcomes")
    .select("outcome")
    .eq("route", "withdrawal")
    .gte("created_at", windowStart);

  if (error || !data) {
    log.warn("Failed to fetch withdrawal outcomes", { error: error?.message });
    return;
  }

  if (data.length < THRESHOLDS.MIN_SAMPLE_SIZE) return;

  const successRate = data.filter(r => r.outcome === "success").length / data.length;

  log.info("Withdrawal success rate", {
    rate:    successRate,
    samples: data.length,
    threshold: THRESHOLDS.WITHDRAWAL_SUCCESS_RATE_MIN,
  });

  if (successRate < THRESHOLDS.WITHDRAWAL_SUCCESS_RATE_MIN) {
    captureWarning("Withdrawal success rate below threshold", {
      rate:      String(successRate.toFixed(4)),
      samples:   String(data.length),
      threshold: String(THRESHOLDS.WITHDRAWAL_SUCCESS_RATE_MIN),
    });
  }
}

export async function checkQuestSuccessRate(): Promise<void> {
  const serviceClient = createServiceClient();
  const windowStart   = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data, error } = await serviceClient
    .from("request_outcomes")
    .select("outcome")
    .eq("route", "quest.daily.complete")
    .gte("created_at", windowStart);

  if (error || !data) {
    log.warn("Failed to fetch quest outcomes", { error: error?.message });
    return;
  }

  if (data.length < THRESHOLDS.MIN_SAMPLE_SIZE) return;

  const successRate = data.filter(r => r.outcome === "success").length / data.length;

  if (successRate < THRESHOLDS.QUEST_SUCCESS_RATE_MIN) {
    captureWarning("Quest success rate below threshold", {
      rate:      String(successRate.toFixed(4)),
      samples:   String(data.length),
      threshold: String(THRESHOLDS.QUEST_SUCCESS_RATE_MIN),
    });
  }
}

// ── Dashboard P95 check (Sprint 13 P2-A) ─────────────────────────────────────

export async function checkDashboardP95(): Promise<void> {
  const serviceClient = createServiceClient();

  const { data, error } = await serviceClient.rpc("get_dashboard_p95", { p_hours: 24 });

  if (error || !data) {
    log.warn("Failed to fetch dashboard P95", { error: error?.message });
    return;
  }

  for (const row of data) {
    log.info("Dashboard latency", {
      user_stage: row.user_stage ?? "all",
      samples:    row.samples,
      p50_ms:     row.p50_ms,
      p95_ms:     row.p95_ms,
      p99_ms:     row.p99_ms,
    });

    if (row.samples < THRESHOLDS.MIN_SAMPLE_SIZE) continue;

    if (row.p95_ms > THRESHOLDS.DASHBOARD_P95_MAX_MS) {
      captureWarning("Dashboard P95 exceeds threshold", {
        user_stage: row.user_stage ?? "all",
        p95_ms:     String(row.p95_ms),
        p99_ms:     String(row.p99_ms),
        threshold:  String(THRESHOLDS.DASHBOARD_P95_MAX_MS),
        samples:    String(row.samples),
      });
    }
  }
}

// ── Cron entry point ──────────────────────────────────────────────────────────

export async function runAllChecks(): Promise<void> {
  const end = log.time("business metrics check");

  await Promise.allSettled([
    checkDepositSuccessRate(),
    checkWithdrawalSuccessRate(),
    checkQuestSuccessRate(),
    checkDashboardP95(),
  ]);

  end();
}