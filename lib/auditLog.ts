/**
 * lib/auditLog.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Writes immutable business/financial event records to audit_logs
 * (migration 027). Distinct from lib/adminAudit.ts's auditLog(), which
 * writes admin CRUD before/after snapshots to admin_audit_log — see the
 * header comment in 027_audit_logs.sql for the full rationale on why
 * these are two separate tables.
 *
 * DESIGN
 *   • Fire-and-forget by default: a failed audit write must never fail
 *     the underlying business operation that already succeeded (the
 *     deposit happened; failing to log it shouldn't undo it or 500 the
 *     response). Failures are logged and reported to Sentry instead.
 *   • Always uses the service-role client — audit_logs has no INSERT
 *     policy for the authenticated role by design (see migration 027).
 *   • Call this AFTER the underlying mutation succeeds, with the final
 *     state in `metadata` — for events with no natural "before" (like a
 *     deposit), metadata IS the record, not a diff.
 *
 * USAGE
 *   await writeAuditLog({
 *     userId:     user.id,
 *     eventType:  "DEPOSIT_CREATED",
 *     entityType: "transaction",
 *     entityId:   tx.id,
 *     metadata:   { amount, goal_id, idempotency_key },
 *     requestId,
 *   });
 */

import { createServiceClient } from "@/lib/supabase/server";
import { createLogger } from "@/lib/logger";
import { captureWarning } from "@/lib/monitoring";

const log = createLogger("audit");

export type AuditEventType =
  | "GOAL_CREATED"
  | "GOAL_EDITED"
  | "GOAL_DELETED"
  | "DEPOSIT_CREATED"
  | "WITHDRAWAL_CREATED"
  | "ACCOUNT_DELETED"
  | "ADMIN_BADGE_CREATED"
  | "ADMIN_QUEST_CREATED";

export type AuditEntityType = "goal" | "transaction" | "account" | "badge" | "quest";

export interface AuditLogParams {
  userId: string;
  eventType: AuditEventType;
  entityType: AuditEntityType;
  /** Nullable — ACCOUNT_DELETED has no separate entity beyond the account itself. */
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  requestId?: string;
}

/**
 * Writes one row to audit_logs. Never throws — logs and reports to Sentry
 * on failure, but always returns normally so callers don't need try/catch.
 */
export async function writeAuditLog(params: AuditLogParams): Promise<void> {
  const { userId, eventType, entityType, entityId = null, metadata = {}, requestId } = params;

  try {
    const service = createServiceClient();
    const { error } = await service.from("audit_logs").insert({
      user_id:     userId,
      event_type:  eventType,
      entity_type: entityType,
      entity_id:   entityId,
      metadata,
      request_id:  requestId ?? null,
    });

    if (error) {
      log.warn("Audit log write failed", {
        user_id: userId, request_id: requestId, event_type: eventType,
        entity_type: entityType, entity_id: entityId, error: error.message,
      });
      captureWarning(`audit_logs insert failed for ${eventType}`, {
        route: "writeAuditLog", user_id: userId, request_id: requestId, event_type: eventType,
      });
    }
  } catch (err: any) {
    // Catch-all: e.g. createServiceClient() itself throwing on missing env.
    // The underlying business operation has already succeeded — never let
    // an audit logging failure surface as an error to the user.
    log.warn("Audit log write threw", {
      user_id: userId, request_id: requestId, event_type: eventType,
      error: err.message ?? String(err),
    });
    captureWarning(`audit_logs write threw for ${eventType}`, {
      route: "writeAuditLog", user_id: userId, request_id: requestId, event_type: eventType,
    });
  }
}