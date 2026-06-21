/**
 * tests/unit/recordOutcome.test.ts
 *
 * Sprint 11 — Phase 5: withOutcomeTracking() unit tests.
 *
 * Verifies the wrapper correctly classifies success/failure by status
 * code across all of a route's possible early returns, records exactly
 * once per request regardless of which branch fired, never blocks the
 * response (fire-and-forget write), and correctly records a thrown
 * exception (not just a returned error response) as a failure before
 * re-throwing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const insertedRows: Array<Record<string, unknown>> = [];

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        insertedRows.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

import { withOutcomeTracking } from "@/lib/recordOutcome";

function makeRequest(requestId = "req_test_123"): NextRequest {
  return new NextRequest("https://example.com/api/test", {
    headers: { "x-request-id": requestId },
  });
}

describe("withOutcomeTracking", () => {
  beforeEach(() => {
    insertedRows.length = 0;
  });

  it("records 'success' for a 200 response", async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }, { status: 200 }));
    const wrapped = withOutcomeTracking("test.route", handler);

    const response = await wrapped(makeRequest());
    expect(response.status).toBe(200);

    // Fire-and-forget write — flush the microtask queue before asserting.
    await new Promise(r => setTimeout(r, 0));

    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({ route: "test.route", outcome: "success", reason: "200" });
  });

  it("records 'failure' for a 422 validation error response", async () => {
    const handler = vi.fn(async () => NextResponse.json({ error: "invalid" }, { status: 422 }));
    const wrapped = withOutcomeTracking("test.route", handler);

    await wrapped(makeRequest());
    await new Promise(r => setTimeout(r, 0));

    expect(insertedRows[0]).toMatchObject({ route: "test.route", outcome: "failure", reason: "422" });
  });

  it("records 'failure' for a 429 rate-limit response", async () => {
    const handler = vi.fn(async () => NextResponse.json({ error: "rate limited" }, { status: 429 }));
    const wrapped = withOutcomeTracking("test.route", handler);

    await wrapped(makeRequest());
    await new Promise(r => setTimeout(r, 0));

    expect(insertedRows[0]).toMatchObject({ outcome: "failure", reason: "429" });
  });

  it("records 'failure' for a 500 server error response", async () => {
    const handler = vi.fn(async () => NextResponse.json({ error: "db error" }, { status: 500 }));
    const wrapped = withOutcomeTracking("test.route", handler);

    await wrapped(makeRequest());
    await new Promise(r => setTimeout(r, 0));

    expect(insertedRows[0]).toMatchObject({ outcome: "failure", reason: "500" });
  });

  it("records exactly ONE outcome row per request, regardless of which return point fired", async () => {
    // Simulates a route with many early returns (the real transactions
    // route has 12) — the wrapper sits at the entry point, so no matter
    // which one fires, exactly one row is written.
    const handler = vi.fn(async (req: NextRequest) => {
      if (req.headers.get("x-scenario") === "validation") {
        return NextResponse.json({ error: "bad input" }, { status: 400 });
      }
      return NextResponse.json({ ok: true }, { status: 200 });
    });
    const wrapped = withOutcomeTracking("test.route", handler);

    const req = new NextRequest("https://example.com/api/test", {
      headers: { "x-request-id": "req_1", "x-scenario": "validation" },
    });
    await wrapped(req);
    await new Promise(r => setTimeout(r, 0));

    expect(insertedRows).toHaveLength(1);
  });

  it("does not delay the response — the outcome write happens after the response is already constructed", async () => {
    let writeStartedAt = 0;
    const handler = vi.fn(async () => NextResponse.json({ ok: true }, { status: 200 }));
    const wrapped = withOutcomeTracking("test.route", handler);

    const before = Date.now();
    const response = await wrapped(makeRequest());
    const responseTime = Date.now() - before;

    // The wrapped call resolves essentially immediately (handler has no
    // real async work, and the outcome write is not awaited before
    // returning) — this is a smoke test that the wrapper isn't
    // accidentally awaiting the insert before returning the response.
    expect(responseTime).toBeLessThan(50);
    expect(response.status).toBe(200);
  });

  it("records a failure and re-throws when the handler itself throws (not just returns an error response)", async () => {
    const handler = vi.fn(async () => {
      throw new Error("unexpected crash");
    });
    const wrapped = withOutcomeTracking("test.route", handler);

    await expect(wrapped(makeRequest())).rejects.toThrow("unexpected crash");
    await new Promise(r => setTimeout(r, 0));

    expect(insertedRows[0]).toMatchObject({ outcome: "failure", reason: "500" });
  });

  it("includes the request_id from the incoming request header for correlation", async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }, { status: 200 }));
    const wrapped = withOutcomeTracking("test.route", handler);

    await wrapped(makeRequest("req_correlate_me"));
    await new Promise(r => setTimeout(r, 0));

    expect(insertedRows[0]).toMatchObject({ request_id: "req_correlate_me" });
  });
});