/**
 * lib/adminAudit.ts
 *
 * Shared helpers for admin routes:
 *   requireAdmin()  — verifies the caller is an authenticated admin;
 *                     returns { user, service } on success or throws a Response.
 *   auditLog()      — writes a row to admin_audit_log via the service client.
 *
 * Usage:
 *   const { user, service } = await requireAdmin();
 *   // ... perform the DB mutation and capture before/after snapshots ...
 *   await auditLog(service, user.id, 'UPDATE', 'badge', id, before, after);
 */

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextResponse }                       from "next/server";

export type AuditAction     = "CREATE" | "UPDATE" | "DELETE";
export type AuditEntityType =
  | "badge"
  | "daily_quest"
  | "weekly_quest"
  | "quest_chain"
  | "challenge"
  | "event";

/** Verifies the caller is authenticated and has is_admin = true on their profile.
 *  Returns { user, service } — the verified user and a service-role Supabase client.
 *  On failure, throws a NextResponse (401 or 403) to be returned immediately. */
export async function requireAdmin(): Promise<{
  user: { id: string };
  service: ReturnType<typeof createServiceClient>;
}> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles").select("is_admin").eq("id", user.id).single();
  if (!profile?.is_admin) throw NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return { user, service: createServiceClient() };
}

/** Writes a single row to admin_audit_log.
 *  Errors are swallowed with a console.error — a logging failure must never
 *  cause a 500 on the admin mutation that succeeded. */
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
    console.error("[auditLog] Failed to write audit row:", error.message, {
      actorId, action, entityType, entityId,
    });
  }
}