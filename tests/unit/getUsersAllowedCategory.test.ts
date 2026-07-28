/**
 * tests/unit/getUsersAllowedCategory.test.ts
 *
 * Sprint 27 — Phase 17 (Final Audit).
 *
 * getUsersAllowedCategory() was added during this phase's final audit
 * pass after re-checking every canSendNotificationToUser() call site
 * and finding it was being called once per user inside three scheduler
 * loops (weekly summary, monthly digest, group-quest-ending) — a real
 * N+1 that Phase 8's and Phase 13's own dedicated N+1 audits both
 * missed, because the two queries are hidden inside
 * canSendNotificationToUser() itself rather than visible at each loop's
 * call site. Same Supabase-mocking pattern Phase 15 established
 * (tests/unit/notificationCleanupScheduler.test.ts) — verifying real
 * orchestration logic, not just pure functions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let profilesResult: { data: any[] | null; error: any } = { data: [], error: null };
let prefsResult: { data: any[] | null; error: any } = { data: [], error: null };

function makeSelectChain(result: { data: any[] | null; error: any }) {
  const chain: any = {
    in: () => chain,
    then: (resolve: (v: typeof result) => void) => resolve(result),
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => {
        if (table === "profiles") return makeSelectChain(profilesResult);
        if (table === "notification_preferences") return makeSelectChain(prefsResult);
        throw new Error(`Unexpected table in test mock: ${table}`);
      },
    }),
  }),
}));

import { getUsersAllowedCategory } from "@/lib/notifications";

describe("getUsersAllowedCategory", () => {
  beforeEach(() => {
    profilesResult = { data: [], error: null };
    prefsResult = { data: [], error: null };
  });

  it("returns an empty set for no input user ids without querying anything", async () => {
    const result = await getUsersAllowedCategory([], "weekly_summaries");
    expect(result.size).toBe(0);
  });

  it("excludes a user whose global notifications_enabled switch is off, regardless of the category preference", async () => {
    profilesResult = { data: [{ id: "u1", notifications_enabled: false }], error: null };
    prefsResult = { data: [{ user_id: "u1", weekly_summaries: true }], error: null };

    const result = await getUsersAllowedCategory(["u1"], "weekly_summaries");
    expect(result.has("u1")).toBe(false);
  });

  it("excludes a user whose specific category preference is explicitly false", async () => {
    profilesResult = { data: [{ id: "u1", notifications_enabled: true }], error: null };
    prefsResult = { data: [{ user_id: "u1", weekly_summaries: false }], error: null };

    const result = await getUsersAllowedCategory(["u1"], "weekly_summaries");
    expect(result.has("u1")).toBe(false);
  });

  it("includes a user who is globally enabled with the category explicitly true", async () => {
    profilesResult = { data: [{ id: "u1", notifications_enabled: true }], error: null };
    prefsResult = { data: [{ user_id: "u1", weekly_summaries: true }], error: null };

    const result = await getUsersAllowedCategory(["u1"], "weekly_summaries");
    expect(result.has("u1")).toBe(true);
  });

  it("defaults a user with no notification_preferences row at all to allowed (true), matching canSendNotificationToUser()'s own documented default", async () => {
    profilesResult = { data: [{ id: "u1", notifications_enabled: true }], error: null };
    prefsResult = { data: [], error: null }; // no row for u1

    const result = await getUsersAllowedCategory(["u1"], "weekly_summaries");
    expect(result.has("u1")).toBe(true);
  });

  it("handles a mixed batch of many users independently in one call", async () => {
    profilesResult = {
      data: [
        { id: "allowed", notifications_enabled: true },
        { id: "globally-off", notifications_enabled: false },
        { id: "category-off", notifications_enabled: true },
        { id: "no-prefs-row", notifications_enabled: true },
      ],
      error: null,
    };
    prefsResult = {
      data: [
        { user_id: "allowed", weekly_summaries: true },
        { user_id: "globally-off", weekly_summaries: true },
        { user_id: "category-off", weekly_summaries: false },
      ],
      error: null,
    };

    const result = await getUsersAllowedCategory(
      ["allowed", "globally-off", "category-off", "no-prefs-row"],
      "weekly_summaries"
    );

    expect(result.has("allowed")).toBe(true);
    expect(result.has("globally-off")).toBe(false);
    expect(result.has("category-off")).toBe(false);
    expect(result.has("no-prefs-row")).toBe(true);
    expect(result.size).toBe(2);
  });
});
