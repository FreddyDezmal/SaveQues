/**
 * lib/deferredAnalytics.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 11 — Phase 3: Remove Analytics From Critical Path
 *
 * WHY THIS EXISTS, AND WHY NOT next/server's after()
 *   The brief asked for "modern Next.js patterns," which in current
 *   industry practice means `after()`. Confirmed during Phase 1
 *   investigation: `after()` (as `unstable_after`) was introduced in
 *   Next.js 15 RC and requires `experimental.after` in next.config.js.
 *   SaveQuest runs Next.js 14.2.16 (confirmed via node_modules/next/
 *   package.json). Importing `after` from `next/server` on this version
 *   does not exist and would fail the build.
 *
 *   The correct mechanism on the CURRENT Next.js version is `waitUntil`
 *   from `@vercel/functions` — a platform-level (not Next.js-version-
 *   gated) primitive that Vercel's own documentation explicitly
 *   recommends as the pre-15.1 equivalent of `after()`. It works
 *   identically inside App Router Route Handlers (confirmed via Vercel's
 *   own production code examples during Phase 1 research). The call
 *   signature this module exposes (`deferAnalytics(fn)`) is intentionally
 *   styled to make a future migration to `after()` a one-line change in
 *   THIS file only, once the project upgrades to Next.js 15+ — no call
 *   site elsewhere in the codebase needs to change.
 *
 * WHAT MOVES, WHAT DOESN'T (see Phase 1 findings — this is a deliberate,
 * narrower scope than "everything non-essential")
 *   MOVES:    PostHog event tracking (trackServerEvent calls). These are
 *             genuine external HTTP calls (confirmed: each one
 *             constructs, flushes, and tears down a PostHog client) with
 *             no bearing on financial correctness — SaveQuest's source of
 *             truth for "did this deposit happen" is the transactions
 *             table + audit_logs, never PostHog.
 *   STAYS:    writeAuditLog() and recordDailyActivity(). Both are
 *             Supabase/PostgREST calls — the same low-latency, same-
 *             infrastructure path every other DB operation in the
 *             request already uses. audit_logs is explicitly the
 *             financial source of truth (migration 027); moving it
 *             off the critical path would reintroduce a silent-gap risk
 *             the audit-logging sprint was built specifically to
 *             eliminate. This distinction was the most important
 *             correction Phase 1 made to the original Scaling Audit,
 *             which had conflated these two categories of call.
 *
 * FAILURE HANDLING
 *   A deferred PostHog call that throws (e.g. PostHog is down, or rate
 *   limiting the API key) must NEVER surface to the user — the response
 *   has already been sent by the time this runs. Every call is wrapped
 *   in its own try/catch with structured logging + Sentry capture, so a
 *   PostHog outage is visible to the team without being visible to the
 *   user or affecting the financial action's own success.
 *
 * USAGE
 *   import { deferAnalytics } from "@/lib/deferredAnalytics";
 *
 *   // ... inside a route handler, AFTER constructing the response data,
 *   // but the call itself can happen anywhere before `return` — waitUntil
 *   // queues the work, it does not block:
 *   deferAnalytics(async () => {
 *     await trackServerEvent(AnalyticsEvents.DEPOSIT_MADE, user.id, { ... });
 *     await trackServerEvent(AnalyticsEvents.XP_AWARDED, user.id, { ... });
 *     // ... all PostHog calls for this request, still sequential WITHIN
 *     // the deferred block (no need to parallelize them — they no longer
 *     // cost the user any latency either way), but none of them block
 *     // the response.
 *   });
 *
 *   return NextResponse.json({ ... });  // sent immediately, does not
 *                                        // wait for the block above
 */

import { waitUntil } from "@vercel/functions";
import { createLogger } from "@/lib/logger";
import { captureError } from "@/lib/monitoring";

const log = createLogger("deferred-analytics");

/**
 * Queues `fn` to run after the response has been sent, using Vercel's
 * waitUntil() to keep the serverless function alive until it settles.
 * Never throws into the caller — any error inside `fn` is caught, logged,
 * and reported to Sentry, but cannot affect the response that was already
 * returned to the user.
 *
 * `label` and `context` are used only for logging/Sentry correlation if
 * `fn` throws — they have no effect on execution.
 */
export function deferAnalytics(
  fn: () => Promise<void>,
  label: string,
  context?: Record<string, string | number | boolean | null | undefined>
): void {
  waitUntil(
    fn().catch((err: any) => {
      log.error("Deferred analytics block failed", {
        label,
        error: err?.message ?? String(err),
        ...context,
      });
      captureError(err, { route: `deferredAnalytics:${label}`, ...context });
      // Deliberately not re-thrown — waitUntil has nothing to deliver a
      // rejection to at this point (the response is already gone), and
      // an unhandled rejection here would only pollute the function's
      // logs with a stack trace that captureError above already records
      // with full context.
    })
  );
}