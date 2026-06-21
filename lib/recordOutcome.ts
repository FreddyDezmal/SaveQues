/**
 * lib/recordOutcome.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 11 — Phase 4: Business Outcome Monitoring (supporting infrastructure)
 *
 * Wraps a route handler so every request's outcome (success/failure) is
 * recorded to request_outcomes (migration 030) exactly once, regardless of
 * which of the route's many early-return branches actually fires.
 *
 * WHY A WRAPPER, NOT INLINE CALLS AT EVERY RETURN
 *   app/api/transactions/route.ts alone has 12 distinct return points
 *   (validation failures, rate limit, ownership check, insert error, XP
 *   award failure, success). Instrumenting each one inline is invasive,
 *   easy to miss in a future edit (a new early-return added later could
 *   silently skip instrumentation), and mixes monitoring concerns into
 *   business logic throughout the file. A single wrapper at the route's
 *   entry point, that inspects the response status code on the way out,
 *   gets every branch for free and can never drift out of sync with the
 *   route's own control flow.
 *
 * HOW SUCCESS/FAILURE IS DETERMINED
 *   Any HTTP status >= 400 is recorded as 'failure'; anything else (200,
 *   201, etc.) is 'success'. This is intentionally coarse — it does not
 *   try to distinguish "user error" (422 validation) from "server error"
 *   (500 database failure) in the outcome column, because the brief's
 *   ask is a SUCCESS RATE for the business outcome ("did the deposit go
 *   through"), not a detailed error taxonomy (Sentry already has that,
 *   tagged by route and request_id). The `reason` column captures the
 *   status code for basic triage without duplicating Sentry's job.
 *
 * NON-BLOCKING
 *   The write to request_outcomes happens via a fire-and-forget call
 *   (not awaited before returning the response to the client) — this is
 *   monitoring data, not the financial record (audit_logs stays
 *   synchronous; see Phase 1 investigation notes on why those are not
 *   the same category of write). A slow or failing write to
 *   request_outcomes must never add latency to the user-facing response
 *   or cause a route to fail.
 *
 * USAGE
 *   export const POST = withOutcomeTracking("transactions.deposit", async (req) => {
 *     // ... existing handler body, completely unchanged ...
 *   });
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("outcome-tracking");

type RouteHandler = (req: NextRequest, ctx?: unknown) => Promise<NextResponse>;

/**
 * Fire-and-forget write to request_outcomes. Never awaited by the caller,
 * never throws into the caller's control flow.
 */
function recordOutcomeAsync(route: string, status: number, requestId: string | null): void {
  const outcome = status < 400 ? "success" : "failure";

  // Deliberately not awaited — see file header "NON-BLOCKING" section.
  createServiceClient()
    .from("request_outcomes")
    .insert({ route, outcome, reason: String(status), user_id: null, request_id: requestId })
    .then(({ error }) => {
      if (error) {
        log.warn("Failed to record request outcome", { route, status, error: error.message });
      }
    });
}

/**
 * Wraps a route handler so its outcome is recorded to request_outcomes
 * after the response is determined, without delaying the response.
 *
 * `route` should match the createLogger() service name already used in
 * the wrapped route, for consistency between logs and this metric
 * (e.g. "transactions.deposit", "transactions.withdrawal",
 * "quest.daily.complete").
 */
export function withOutcomeTracking(route: string, handler: RouteHandler): RouteHandler {
  return async (req: NextRequest, ctx?: unknown): Promise<NextResponse> => {
    // request_id is set by middleware.ts on every request (confirmed in
    // an earlier sprint) — this is a reliable correlation key, unlike
    // user_id, which is NOT present in any of these routes' JSON
    // response bodies (verified directly; an earlier draft of this
    // wrapper incorrectly assumed it was and read undefined every time —
    // corrected before this shipped). request_id lets a failure spike in
    // this metric be cross-referenced with the matching structured log
    // lines and Sentry events for the same requests.
    const requestId = req.headers.get("x-request-id");
    let response: NextResponse;

    try {
      response = await handler(req, ctx);
    } catch (err) {
      // The handler threw rather than returning a NextResponse — record
      // this as a failure with status 500, then re-throw so Next.js's
      // own error handling (and any existing captureError in the route)
      // behaves exactly as it did before this wrapper was added.
      recordOutcomeAsync(route, 500, requestId);
      throw err;
    }

    recordOutcomeAsync(route, response.status, requestId);
    return response;
  };
}