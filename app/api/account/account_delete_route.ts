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
import { NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { captureError } from "@/lib/monitoring";

const log = createLogger("account.delete");

export async function DELETE() {
  // 1. Verify the caller is authenticated using the anon client
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = user.id;
  const end = log.time("account deletion", { user_id: userId });

  try {
    // 2. Use service-role client to call admin.deleteUser
    //    This deletes auth.users(id) which cascades to profiles and all data.
    const adminClient = createServiceClient();
    const { error } = await adminClient.auth.admin.deleteUser(userId);

    if (error) {
      log.error("admin.deleteUser failed", {
        user_id:    userId,
        error:      error.message,
      });
      captureError(error, {
        route:   "DELETE /api/account",
        user_id: userId,
      });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    end({ user_id: userId });
    return NextResponse.json({ deleted: true });

  } catch (err: any) {
    log.error("Unexpected error during account deletion", {
      user_id: userId,
      error:   err.message ?? String(err),
    });
    captureError(err, { route: "DELETE /api/account", user_id: userId });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}