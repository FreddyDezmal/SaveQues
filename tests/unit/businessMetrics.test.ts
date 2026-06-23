/**
 * tests/unit/businessMetrics.test.ts
 *
 * Sprint 11 — Phase 5: business metrics threshold logic tests.
 *
 * Verifies the alerting boolean fires correctly at, above, and below the
 * configured thresholds, and respects MIN_SAMPLE_SIZE (no alert on a
 * sample too small to be meaningful — 1 failure out of 1 attempt is a 0%
 * rate that tells you nothing). The Supabase client is mocked so these
 * tests exercise the THRESHOLD MATH in isolation, not real database
 * behavior — that's covered by the integration test plan in this same
 * sprint's deliverables, run against a real (test) Supabase project.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Supabase service client ────────────────────────────────────────────
// Each test configures what the mocked query chain returns via this
// mutable holder, then calls the function under test.
let mockPushSubscriptionsCount = 0;
let mockNotificationLogs: Array<{ error: string | null }> = [];
let mockRequestOutcomes: Array<{ outcome: string }> = [];

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === "push_subscriptions") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ count: mockPushSubscriptionsCount, error: null }),
          }),
        };
      }
      if (table === "notification_logs") {
        return {
          select: () => ({
            gte: () => Promise.resolve({ data: mockNotificationLogs, error: null }),
          }),
        };
      }
      if (table === "request_outcomes") {
        return {
          select: () => ({
            eq: () => ({
              gte: () => Promise.resolve({ data: mockRequestOutcomes, error: null }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table in test mock: ${table}`);
    },
  }),
}));

const captureWarningMock = vi.fn();
vi.mock("@/lib/monitoring", () => ({
  captureWarning: (...args: unknown[]) => captureWarningMock(...args),
  captureError: vi.fn(),
}));

import {
  checkNotificationDeliveryRate,
  checkDepositSuccessRate,
} from "@/lib/businessMetrics";

describe("checkNotificationDeliveryRate", () => {
  beforeEach(() => {
    captureWarningMock.mockClear();
    mockPushSubscriptionsCount = 0;
    mockNotificationLogs = [];
  });

  it("does not alert when delivery rate is above the 50% threshold", async () => {
    mockPushSubscriptionsCount = 10;
    mockNotificationLogs = Array(8).fill({ error: null }); // 8/10 = 80%

    const result = await checkNotificationDeliveryRate();

    expect(result.deliveryRate).toBeCloseTo(0.8);
    expect(result.alerted).toBe(false);
    expect(captureWarningMock).not.toHaveBeenCalled();
  });

  it("alerts when delivery rate falls below the 50% threshold, given a meaningful sample size", async () => {
    mockPushSubscriptionsCount = 10;
    mockNotificationLogs = Array(3).fill({ error: null }); // 3/10 = 30%

    const result = await checkNotificationDeliveryRate();

    expect(result.deliveryRate).toBeCloseTo(0.3);
    expect(result.alerted).toBe(true);
    expect(captureWarningMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT alert below threshold when the eligible sample size is too small to be meaningful", async () => {
    // 1 eligible user, 0 notified = 0% — a real number, but meaningless
    // at n=1. MIN_SAMPLE_SIZE (5) exists exactly to prevent this from
    // paging someone over normal beta-stage variance.
    mockPushSubscriptionsCount = 1;
    mockNotificationLogs = [];

    const result = await checkNotificationDeliveryRate();

    expect(result.alerted).toBe(false);
    expect(captureWarningMock).not.toHaveBeenCalled();
  });

  it("treats a delivery rate exactly AT the threshold as healthy (not below it)", async () => {
    // Sprint 12 audit raised threshold from 50% to 70%.
    // This test verifies the boundary: exactly 70% should NOT alert
    // (strictly LESS than threshold alerts, not <=).
    mockPushSubscriptionsCount = 10;
    mockNotificationLogs = Array(7).fill({ error: null }); // exactly 70%

    const result = await checkNotificationDeliveryRate();

    expect(result.deliveryRate).toBeCloseTo(0.7);
    expect(result.alerted).toBe(false); // strictly LESS than threshold alerts, not <=
  });

  it("counts failed sends (error is not null) separately from successful ones", async () => {
    mockPushSubscriptionsCount = 10;
    mockNotificationLogs = [
      ...Array(6).fill({ error: null }),
      ...Array(2).fill({ error: "push subscription expired" }),
    ];

    const result = await checkNotificationDeliveryRate();

    expect(result.attempted).toBe(8);
    expect(result.sent).toBe(6);
    expect(result.failed).toBe(2);
  });
});

describe("checkDepositSuccessRate", () => {
  beforeEach(() => {
    captureWarningMock.mockClear();
    mockRequestOutcomes = [];
  });

  it("does not alert when success rate is above the 95% threshold", async () => {
    mockRequestOutcomes = [
      ...Array(19).fill({ outcome: "success" }),
      { outcome: "failure" }, // 19/20 = 95% exactly
    ];

    const result = await checkDepositSuccessRate();

    expect(result.successRate).toBeCloseTo(0.95);
    expect(result.alerted).toBe(false); // exactly at threshold, not below
  });

  it("alerts when success rate falls below the 95% threshold, given a meaningful sample size", async () => {
    mockRequestOutcomes = [
      ...Array(15).fill({ outcome: "success" }),
      ...Array(5).fill({ outcome: "failure" }), // 15/20 = 75%
    ];

    const result = await checkDepositSuccessRate();

    expect(result.successRate).toBeCloseTo(0.75);
    expect(result.alerted).toBe(true);
    expect(captureWarningMock).toHaveBeenCalledTimes(1);
  });

  it("does not alert with zero attempts (null rate, nothing to compare)", async () => {
    mockRequestOutcomes = [];

    const result = await checkDepositSuccessRate();

    expect(result.successRate).toBe(null);
    expect(result.alerted).toBe(false);
  });
});