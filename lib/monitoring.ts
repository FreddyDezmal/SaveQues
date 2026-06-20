/**
 * lib/monitoring.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Thin wrapper around Sentry for SaveQuest-specific error reporting.
 *
 * USAGE
 *   // In API routes — set user context for every request:
 *   import { setSentryUser, captureError } from "@/lib/monitoring";
 *   setSentryUser(user.id);
 *
 *   // Capture a caught error with extra context:
 *   captureError(err, { route: "/api/transactions", goal_id });
 *
 *   // Wrap an entire API handler with automatic error capture + timing:
 *   export const POST = withMonitoring("POST /api/transactions", handler);
 *
 * WHY A WRAPPER?
 *   • Keeps Sentry imports out of business logic.
 *   • Lets us swap or disable monitoring without touching every route.
 *   • Always safe to call — never throws, never blocks.
 */

import * as Sentry from "@sentry/nextjs";
import type { NextRequest, NextResponse } from "next/server";

// ── User context ───────────────────────────────────────────────────────────────

/**
 * Attach the authenticated user ID to all subsequent Sentry events in this
 * request context. Call once per API route after auth verification.
 * Passing null clears the user (e.g. on logout).
 */
export function setSentryUser(userId: string | null): void {
  try {
    if (userId) {
      Sentry.setUser({ id: userId });
    } else {
      Sentry.setUser(null);
    }
  } catch { /* never throw */ }
}

// ── Error capture ──────────────────────────────────────────────────────────────

/**
 * Capture an exception with optional extra context tags.
 * Safe to call anywhere — errors in capture itself are swallowed.
 *
 * Pass `request_id` in context (from req.headers.get("x-request-id")) to
 * link this Sentry event with the corresponding structured log lines for
 * the same request — searchable in both systems by the same value.
 */
export function captureError(
  err: unknown,
  context?: Record<string, string | number | boolean | null | undefined>
): void {
  try {
    Sentry.withScope(scope => {
      if (context) {
        for (const [key, value] of Object.entries(context)) {
          scope.setTag(key, String(value ?? "null"));
        }
      }
      Sentry.captureException(err);
    });
  } catch { /* never throw */ }
}

/**
 * Capture a non-fatal message at warning level.
 */
export function captureWarning(
  message: string,
  context?: Record<string, string | number | boolean | null | undefined>
): void {
  try {
    Sentry.withScope(scope => {
      scope.setLevel("warning");
      if (context) {
        for (const [key, value] of Object.entries(context)) {
          scope.setTag(key, String(value ?? "null"));
        }
      }
      Sentry.captureMessage(message);
    });
  } catch { /* never throw */ }
}

// ── Route wrapper ──────────────────────────────────────────────────────────────

type RouteHandler = (req: NextRequest, ctx?: unknown) => Promise<NextResponse | Response>;

/**
 * Wrap a Next.js API route handler with automatic error capture and timing.
 *
 * @example
 *   export const POST = withMonitoring("POST /api/transactions", async (req) => {
 *     // ... handler body
 *   });
 */
export function withMonitoring(
  routeName: string,
  handler: RouteHandler
): RouteHandler {
  return async (req: NextRequest, ctx?: unknown) => {
    const start = Date.now();
    try {
      const response = await handler(req, ctx);
      const duration = Date.now() - start;

      // Log slow routes (>3 s) as warnings
      if (duration > 3000) {
        captureWarning(`Slow route: ${routeName} took ${duration}ms`, {
          route:    routeName,
          duration: duration,
        });
      }

      return response;
    } catch (err) {
      captureError(err, {
        route:       routeName,
        duration_ms: Date.now() - start,
        method:      req.method,
        url:         req.url,
      });
      // Re-throw so Next.js can return a 500
      throw err;
    }
  };
}

// ── Manual test helper (development only) ────────────────────────────────────

/**
 * Throw a test exception to verify Sentry is wired up correctly.
 * Only available in non-production environments.
 * Hit GET /api/debug/sentry-test to trigger it.
 */
export function throwTestException(): never {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Test exceptions are not available in production.");
  }
  throw new Error(
    `[SaveQuest Sentry test] This is a manually triggered test exception — ${new Date().toISOString()}`
  );
}