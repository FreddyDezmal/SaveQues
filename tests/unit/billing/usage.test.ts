/**
 * tests/unit/billing/usage.test.ts
 *
 * Sprint 29 — Premium Subscription Platform, Phase 16. Tests
 * periodStartFor() — the pure date-bucketing logic in
 * lib/billing/usage.ts. Does NOT test checkUsage()/recordUsage()
 * themselves (Supabase-fetching wrappers — see the same documented gap
 * noted in entitlements.test.ts).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { periodStartFor } from "@/lib/billing/usage";

describe("periodStartFor", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("'day' returns the current UTC date as YYYY-MM-DD", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T23:59:00Z"));
    expect(periodStartFor("day")).toBe("2026-07-31");
  });

  it("'month' returns the first of the current UTC month", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T23:59:00Z"));
    expect(periodStartFor("month")).toBe("2026-07-01");
  });

  it("'lifetime' always returns the fixed sentinel date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T23:59:00Z"));
    expect(periodStartFor("lifetime")).toBe("1970-01-01");
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    expect(periodStartFor("lifetime")).toBe("1970-01-01");
  });

  it("'day' rolls over at the UTC midnight boundary, not local time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T00:00:01Z"));
    expect(periodStartFor("day")).toBe("2026-03-01");
    vi.setSystemTime(new Date("2026-02-28T23:59:59Z"));
    expect(periodStartFor("day")).toBe("2026-02-28");
  });

  it("'month' handles a leap-year February correctly", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2028-02-29T12:00:00Z")); // 2028 is a leap year
    expect(periodStartFor("month")).toBe("2028-02-01");
  });
});
