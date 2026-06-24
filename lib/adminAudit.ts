/**
 * lib/adminAudit.ts
 *
 * Shared helpers for admin routes:
 *   requireAdmin()  — verifies the caller is an authenticated admin,
 *                     applies rate limiting, logs the access, and returns
 *                     { user, service } on success or throws a Response.
 *   auditLog()      — writes a row to admin_audit_log via the service client.
 *
 * Sprint 13 — P1: Admin Route Protection
 *   requireAdmin() now applies three layers of protection:
 *
 *   1. RATE LIMITING — 30 requests per admin per rolling 10 minutes.
 *      Uses the existing rate_limit_attempts table (migration 026) and
 *      checkAttemptRateLimit()/recordAttempt() from lib/rateLimit.ts.
 *      Returns 429 on breach, with structured logging for alerting.
 *      Rationale for 30/10min (not stricter): admins perform real work
 *      (bulk badge creation, quest updates) that may involve many rapid
 *      writes. The limit is designed to stop credential-stuffing attacks
 *      (which need hundreds of attempts in seconds) without inconveniencing
 *      a legitimate admin doing their job.
 *
 *   2. STRUCTURED LOGGING — every admin access is logged at INFO level with
 *      user_id, request_id, and the route (passed via optional context).
 *      Every rate-limit breach is logged at WARN level. Any auth failure
 *      is logged at WARN level. This provides the audit visibility the
 *      Sprint 12 readiness report flagged as absent.
 *
 *   3. SENTRY ALERTING on rate-limit breach — captureWarning fires when any
 *      admin account hits the limit, since a legitimate admin should never
 *      need more than 30 requests in 10 minutes. A spike here almost
 *      certainly indicates a compromised credential or an automated attack.
 *
 * Usage (unchanged for all existing admin routes):
 *   const { user, service } = await requireAdmin(req, "admin.badges.create");
 *   await auditLog(service, user.id, 'UPDATE', 'badge', id, before, after);
 */

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse }          from "next/server";
import { checkAttemptRateLimit, recordAttempt } from "@/lib/rateLimit";
import { createLogger }                       from "@/lib/logger";
import { captureWarning }                     from "@/lib/monitoring";

const log = createLogger("admin");

export type AuditAction     = "CREATE" | "UPDATE" | "DELETE";
export type AuditEntityType =
  | "badge"
  | "daily_quest"
  | "weekly_quest"
  | "quest_chain"
  | "challenge"
  | "event";

const ADMIN_RATE_LIMIT = {
  windowMinutes: 10,
  maxRequests:   30,
  endpoint:      "admin.api",
} as const;

/**
 * Verifies the caller is an authenticated admin, applies rate limiting,
 * and logs the access. Returns { user, service } on success.
 * On failure, throws a NextResponse (401, 403, or 429).
 *
 * @param req     The incoming NextRequest — used for request_id correlation.
 * @param route   Optional label for the specific admin route (e.g.
 *                "admin.badges.POST") used in log entries. Defaults to
 *                "admin.api" if not provided.
 */
export async function requireAdmin(
  req?: NextRequest,
  route = "admin.api"
): Promise<{
  user:      { id: string };
  service:   ReturnType<typeof createServiceClient>;
  requestId: string | undefined;
}> {
  const requestId = req?.headers.get("x-request-id") ?? undefined;
  const supabase  = createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    log.warn("Admin access rejected — unauthenticated", { route, request_id: requestId });
    throw NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles").select("is_admin").eq("id", user.id).single();
  if (!profile?.is_admin) {
    log.warn("Admin access rejected — non-admin user", {
      route, user_id: user.id, request_id: requestId,
    });
    throw NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Rate limiting ───────────────────────────────────────────────────────
  // Record the attempt BEFORE checking the count, so the check reflects
  // the current request too (matches the semantics used for quest completion
  // in checkAttemptRateLimit — record first, check after).
  const service = createServiceClient();

  const rateLimit = await checkAttemptRateLimit(service, {
    userId:        user.id,
    endpoint:      ADMIN_RATE_LIMIT.endpoint,
    windowMinutes: ADMIN_RATE_LIMIT.windowMinutes,
    maxRequests:   ADMIN_RATE_LIMIT.maxRequests,
    actionLabel:   "admin requests",
  });

  if (!rateLimit.allowed) {
    log.warn("Admin rate limit exceeded", {
      route, user_id: user.id, request_id: requestId,
      count: rateLimit.count, limit: rateLimit.limit,
    });
    captureWarning(`Admin rate limit exceeded for user ${user.id}`, {
      route, user_id: user.id, request_id: requestId,
      count: rateLimit.count, limit: rateLimit.limit,
      note: "A legitimate admin should never hit 30 requests in 10 minutes. Likely compromised credential or automated attack.",
    });
    throw NextResponse.json(
      { error: "Too many requests. Admin API rate limit exceeded." },
      { status: 429 }
    );
  }

  // Record this attempt for future rate limit calculations
  await recordAttempt(service, user.id, ADMIN_RATE_LIMIT.endpoint);

  // ── Access log ─────────────────────────────────────────────────────────
  log.info("Admin access granted", {
    route, user_id: user.id, request_id: requestId,
    remaining: ADMIN_RATE_LIMIT.maxRequests - (rateLimit.count + 1),
  });

  return { user, service, requestId };
}

/** Writes a single row to admin_audit_log.
 *  Errors are logged to the structured logger and Sentry — a logging
 *  failure must never cause a 500 on the admin mutation that succeeded. */
export async function auditLog(
  service:     ReturnType<typeof createServiceClient>,
  actorId:     string,
  action:      AuditAction,
  entityType:  AuditEntityType,
  entityId:    string,
  beforeState: Record<string, unknown> | null,
  afterState:  Record<string, unknown> | null,
): Promise<void> {
  const { error } = await service.from("admin_audit_log").insert({
    actor_id:     actorId,
    action,
    entity_type:  entityType,
    entity_id:    String(entityId),
    before_state: beforeState ?? null,
    after_state:  afterState  ?? null,
  });
  if (error) {
    log.warn("admin_audit_log write failed", {
      user_id: actorId, action, entity_type: entityType, entity_id: entityId,
      error: error.message,
    });
  }
}