/**
 * tests/unit/webpush.test.ts
 * Sprint 27 — Phase 8 (Scheduling: retries).
 *
 * Only isRetryable() is unit tested here — it's the one pure decision in
 * lib/webpush.ts. sendWebPush()/sendWebPushWithRetry() themselves do real
 * crypto + a real fetch() to a push endpoint, which this test suite
 * doesn't mock (consistent with this codebase's existing boundary: DB/
 * network-touching code gets integration-level manual-test docs, not unit
 * mocks — see tests/integration/notification-delivery.test.ts).
 */
import { describe, it, expect } from "vitest";
import { isRetryable, type SendResult } from "@/lib/webpush";

describe("isRetryable", () => {
  it("is false for a successful send", () => {
    const result: SendResult = { ok: true, status: 201 };
    expect(isRetryable(result)).toBe(false);
  });

  it("is false for a 410/404 Gone response — permanent, not transient", () => {
    expect(isRetryable({ ok: false, status: 410, gone: true })).toBe(false);
    expect(isRetryable({ ok: false, status: 404, gone: true })).toBe(false);
  });

  it("is false for other non-retryable 4xx responses", () => {
    expect(isRetryable({ ok: false, status: 400 })).toBe(false);
    expect(isRetryable({ ok: false, status: 401 })).toBe(false);
    expect(isRetryable({ ok: false, status: 403 })).toBe(false);
  });

  it("is true for retryable 5xx/429/408 responses", () => {
    expect(isRetryable({ ok: false, status: 500 })).toBe(true);
    expect(isRetryable({ ok: false, status: 502 })).toBe(true);
    expect(isRetryable({ ok: false, status: 503 })).toBe(true);
    expect(isRetryable({ ok: false, status: 429 })).toBe(true);
    expect(isRetryable({ ok: false, status: 408 })).toBe(true);
  });

  it("is true for a network-level failure with no status code", () => {
    expect(isRetryable({ ok: false, error: "fetch failed" })).toBe(true);
  });
});
