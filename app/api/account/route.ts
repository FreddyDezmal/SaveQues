/**
 * app/api/account/route.ts
 *
 * DELETE /api/account
 *
 * Permanently deletes the authenticated user's account by calling
 * supabase.auth.admin.deleteUser() via the service-role client.
 *
 * This is the ONLY correct deletion path because:
 *  - Deleting the profiles row (client-side) does NOT cascade to auth.users.
 *    The FK is profiles.id → auth.users(id), not the reverse.
 *  - deleteUser() deletes the auth.users record, which DOES cascade to
 *    profiles (and all downstream data) via the ON DELETE CASCADE FK.
 *
 * Security:
 *  - Auth required: we verify the caller's session before acting.
 *  - The user can only delete themselves: user.id comes from the
 *    server-side session, not from the request body.
 *  - Service role is used only after identity is confirmed.
 *
 * After deletion the client should call supabase.auth.signOut() to clear
 * local session state and redirect to login.
 */

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { captureError } from "@/lib/monitoring";
import { trackServerEvent, AnalyticsEvents } from "@/lib/analytics-server";
import { writeAuditLog } from "@/lib/auditLog";

const log = createLogger("account.delete");

export async function DELETE(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? undefined;

  // 1. Verify the caller is authenticated using the anon client
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = user.id;
  const end = log.time("account deletion", { user_id: userId, request_id: requestId });

  try {
    // ── 0. CAPTURE STATE BEFORE THE CASCADE ───────────────────────
    // admin.deleteUser() below deletes auth.users(id), which CASCADES to
    // profiles and every dependent table immediately. Anything we want
    // to record about this account MUST be read and written BEFORE that
    // call — afterward, the profile row (and the goals/transactions
    // counts that would make a useful audit record) no longer exist.
    // This is also why audit_logs.user_id (migration 027) is explicitly
    // NOT a foreign key to profiles — a FK with ON DELETE CASCADE would
    // delete this very audit row at the exact moment the cascade fires,
    // destroying the evidence of the deletion we're trying to keep.
    const [goalsRes, txRes] = await Promise.all([
      supabase.from("savings_goals").select("id", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("transactions").select("id", { count: "exact", head: true }).eq("user_id", userId),
    ]);
    const goalsCount = goalsRes.count ?? 0;
    const txCount    = txRes.count ?? 0;

    // ── 1. Audit log — written BEFORE deletion, while user_id is still
    //    meaningful context (the row itself outlives the user by design;
    //    see migration 027's header for why user_id is not a FK here). ──
    await writeAuditLog({
      userId,
      eventType:  "ACCOUNT_DELETED",
      entityType: "account",
      entityId:   userId,
      metadata: {
        goals_count:       goalsCount,
        transactions_count: txCount,
      },
      requestId,
    });

    // ── 2. PostHog — also written BEFORE deletion, for the same reason. ──
    await trackServerEvent(AnalyticsEvents.ACCOUNT_DELETED, userId, {
      goals_count:        goalsCount,
      transactions_count: txCount,
    });

    // ── 3. Use service-role client to call admin.deleteUser
    //    This deletes auth.users(id) which cascades to profiles and all data.
    const adminClient = createServiceClient();
    const { error } = await adminClient.auth.admin.deleteUser(userId);

    if (error) {
      log.error("admin.deleteUser failed", {
        user_id:    userId, request_id: requestId,
        error:      error.message,
      });
      captureError(error, {
        route:   "DELETE /api/account",
        user_id: userId,
        request_id: requestId,
      });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    end({ user_id: userId, request_id: requestId });
    return NextResponse.json({ deleted: true });

  } catch (err: any) {
    log.error("Unexpected error during account deletion", {
      user_id: userId, request_id: requestId,
      error:   err.message ?? String(err),
    });
    captureError(err, { route: "DELETE /api/account", user_id: userId, request_id: requestId });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}