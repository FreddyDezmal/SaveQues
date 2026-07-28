/**
 * tests/unit/notificationCleanupScheduler.test.ts
 *
 * Sprint 27 — Phase 15 (Testing).
 *
 * runNotificationLogsCleanupScheduler() (Phase 13) is scheduler
 * orchestration code — three independent Supabase delete calls — which
 * this codebase's established boundary (see notifications.test.ts's own
 * header, and every prior phase's docs) normally leaves untested in
 * favor of documented manual-verification TODOs, since it needs a real
 * database to fully verify.
 *
 * This test takes the OTHER established pattern already used elsewhere
 * in this codebase (tests/unit/businessMetrics.test.ts,
 * tests/unit/recordOutcome.test.ts): mock the Supabase client itself,
 * and verify the ORCHESTRATION LOGIC — which purges ran, what they
 * returned, and critically, that a failure in one purge doesn't prevent
 * the other two from running (the entire reason Phase 13 used three
 * separate try/catch blocks instead of one). This doesn't replace a
 * real integration test against a live database (still a documented
 * gap — see tests/integration/notification-delivery.test.ts), but it's
 * real, valuable coverage of logic that had none at all before this
 * phase.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Supabase service client ────────────────────────────────────────────
// notification_logs is deleted from TWICE (soft-delete purge, then hard-
// retention purge, in that exact order — see runNotificationLogsCleanupScheduler's
// own implementation) — call count differentiates which configured result
// applies to which call, since both target the same table name.
let notificationLogsCallCount = 0;
let softDeleteResult: { count: number | null; error: any } = { count: 0, error: null };
let hardDeleteResult: { count: number | null; error: any } = { count: 0, error: null };
let subscriptionDeleteResult: { count: number | null; error: any } = { count: 0, error: null };

function makeDeleteChain(result: { count: number | null; error: any }) {
  const chain: any = {
    not: () => chain,
    lt: () => chain,
    eq: () => chain,
    then: (resolve: (v: typeof result) => void) => resolve(result),
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      delete: (_opts?: unknown) => {
        if (table === "notification_logs") {
          notificationLogsCallCount++;
          return makeDeleteChain(notificationLogsCallCount === 1 ? softDeleteResult : hardDeleteResult);
        }
        if (table === "push_subscriptions") {
          return makeDeleteChain(subscriptionDeleteResult);
        }
        throw new Error(`Unexpected table in test mock: ${table}`);
      },
    }),
  }),
}));

import { runNotificationLogsCleanupScheduler } from "@/lib/notifications";

describe("runNotificationLogsCleanupScheduler", () => {
  beforeEach(() => {
    notificationLogsCallCount = 0;
    softDeleteResult = { count: 0, error: null };
    hardDeleteResult = { count: 0, error: null };
    subscriptionDeleteResult = { count: 0, error: null };
    // Suppress the deliberate console.error calls each failure path
    // makes — asserted on via the returned `errors` count instead, not
    // by checking console output.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns the counts from all three independent purges when everything succeeds", async () => {
    softDeleteResult = { count: 5, error: null };
    hardDeleteResult = { count: 12, error: null };
    subscriptionDeleteResult = { count: 3, error: null };

    const result = await runNotificationLogsCleanupScheduler();

    expect(result).toEqual({
      deletedSoftDeleted: 5,
      deletedExpired: 12,
      deletedInactiveSubscriptions: 3,
      errors: 0,
    });
  });

  it("isolates a failure in the soft-delete purge from the other two — the entire point of the separate try/catch blocks", async () => {
    softDeleteResult = { count: null, error: { message: "boom" } };
    hardDeleteResult = { count: 12, error: null };
    subscriptionDeleteResult = { count: 3, error: null };

    const result = await runNotificationLogsCleanupScheduler();

    expect(result.errors).toBe(1);
    expect(result.deletedSoftDeleted).toBe(0); // failed purge contributes nothing, not undefined/throws
    expect(result.deletedExpired).toBe(12); // still ran despite the first purge failing
    expect(result.deletedInactiveSubscriptions).toBe(3); // still ran too
  });

  it("isolates a failure in the hard-retention purge from the other two", async () => {
    softDeleteResult = { count: 5, error: null };
    hardDeleteResult = { count: null, error: { message: "boom" } };
    subscriptionDeleteResult = { count: 3, error: null };

    const result = await runNotificationLogsCleanupScheduler();

    expect(result.errors).toBe(1);
    expect(result.deletedSoftDeleted).toBe(5);
    expect(result.deletedExpired).toBe(0);
    expect(result.deletedInactiveSubscriptions).toBe(3);
  });

  it("isolates a failure in the subscription purge from the other two", async () => {
    softDeleteResult = { count: 5, error: null };
    hardDeleteResult = { count: 12, error: null };
    subscriptionDeleteResult = { count: null, error: { message: "boom" } };

    const result = await runNotificationLogsCleanupScheduler();

    expect(result.errors).toBe(1);
    expect(result.deletedSoftDeleted).toBe(5);
    expect(result.deletedExpired).toBe(12);
    expect(result.deletedInactiveSubscriptions).toBe(0);
  });

  it("counts multiple independent failures rather than stopping at the first", async () => {
    softDeleteResult = { count: null, error: { message: "boom1" } };
    hardDeleteResult = { count: null, error: { message: "boom2" } };
    subscriptionDeleteResult = { count: 7, error: null };

    const result = await runNotificationLogsCleanupScheduler();

    expect(result.errors).toBe(2);
    expect(result.deletedInactiveSubscriptions).toBe(7); // the one that didn't fail still completed
  });

  it("treats a null count (no matching rows) as zero rather than throwing or returning undefined", async () => {
    softDeleteResult = { count: null, error: null };
    hardDeleteResult = { count: null, error: null };
    subscriptionDeleteResult = { count: null, error: null };

    const result = await runNotificationLogsCleanupScheduler();

    expect(result).toEqual({
      deletedSoftDeleted: 0,
      deletedExpired: 0,
      deletedInactiveSubscriptions: 0,
      errors: 0,
    });
  });
});
