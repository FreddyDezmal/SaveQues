/**
 * tests/unit/deferredAnalytics.test.ts
 *
 * Sprint 11 — Phase 5: deferAnalytics() unit tests.
 *
 * Verifies the core contract lib/deferredAnalytics.ts exists to provide:
 *   1. The wrapped function is queued via waitUntil(), not awaited inline
 *      (i.e. it does not block the caller).
 *   2. An error thrown inside the deferred function is caught and never
 *      propagates to the caller — this is the critical safety property,
 *      since by the time this code runs the HTTP response has already
 *      been sent and there is nothing left to deliver a rejection to.
 *
 * @vercel/functions' waitUntil() is mocked here rather than exercised for
 * real, because real waitUntil() requires the Vercel request-context
 * machinery (globalThis[Symbol.for('@next/request-context')]) that only
 * exists inside an actual Vercel function invocation — outside of that
 * context it throws "waitUntil was called outside of a request context."
 * Mocking it is the correct unit-test boundary: this test verifies
 * deferAnalytics() calls waitUntil() correctly and handles the promise it
 * passes in correctly, not whether Vercel's own platform primitive works
 * (that's Vercel's responsibility, not this codebase's).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const waitUntilMock = vi.fn((promise: Promise<unknown>) => promise);

vi.mock("@vercel/functions", () => ({
  waitUntil: (p: Promise<unknown>) => waitUntilMock(p),
}));

const captureErrorMock = vi.fn();
vi.mock("@/lib/monitoring", () => ({
  captureError: (...args: unknown[]) => captureErrorMock(...args),
}));

import { deferAnalytics } from "@/lib/deferredAnalytics";

describe("deferAnalytics", () => {
  beforeEach(() => {
    waitUntilMock.mockClear();
    captureErrorMock.mockClear();
  });

  it("calls waitUntil() with the result of invoking fn — queues work, does not await it inline", () => {
    let resolved = false;
    const fn = async () => {
      await new Promise(r => setTimeout(r, 0));
      resolved = true;
    };

    deferAnalytics(fn, "test.label");

    // deferAnalytics() itself is synchronous (returns void, not a
    // Promise) — the caller's control flow must not be blocked by it.
    // At this point, fn's internal await has not yet resolved.
    expect(waitUntilMock).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(false);
  });

  it("does not throw when the deferred function rejects", async () => {
    const failingFn = async () => {
      throw new Error("PostHog is down");
    };

    expect(() => deferAnalytics(failingFn, "test.failure")).not.toThrow();

    // Let the queued promise (and its internal .catch handler) settle.
    await waitUntilMock.mock.results[0]?.value?.catch(() => {});
  });

  it("reports a rejected deferred function to Sentry via captureError, with the label and context", async () => {
    const failingFn = async () => {
      throw new Error("PostHog is down");
    };

    deferAnalytics(failingFn, "transactions.deposit", { user_id: "u_123", request_id: "r_456" });

    // Allow the microtask queue to flush the internal .catch() handler.
    await waitUntilMock.mock.results[0]?.value?.catch(() => {});
    await new Promise(r => setTimeout(r, 0));

    expect(captureErrorMock).toHaveBeenCalledTimes(1);
    const [, context] = captureErrorMock.mock.calls[0];
    expect(context).toMatchObject({
      route: "deferredAnalytics:transactions.deposit",
      user_id: "u_123",
      request_id: "r_456",
    });
  });

  it("does not call captureError when the deferred function succeeds", async () => {
    const okFn = async () => { /* succeeds */ };

    deferAnalytics(okFn, "test.success");
    await waitUntilMock.mock.results[0]?.value;

    expect(captureErrorMock).not.toHaveBeenCalled();
  });
});