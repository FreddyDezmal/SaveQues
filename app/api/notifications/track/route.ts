import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Called by the service worker when a push is received, clicked, or
 * dismissed. The notification ID is stored in the push payload and
 * passed here.
 *
 * Sprint 27, Phase 11: added "dismissed" — previously the service
 * worker's dismiss action button closed the notification but never
 * reported it, so dismissed_at was always null for every notification
 * ever sent. See public/sw.js's own comments for the full fix.
 *
 * Security (H2 fix):
 *  • Requires authentication — unauthenticated requests are rejected with 401.
 *  • Scopes the update to BOTH notification id AND the authenticated user_id,
 *    preventing a user from updating another user's notification log entry.
 *  • Sprint 27, Phase 14 correction: an earlier version of this comment
 *    claimed notification_logs has no UPDATE RLS policy at all. That was
 *    inaccurate — notification_logs_update_own_read_state (migration 038)
 *    already enforces `auth.uid() = user_id` for UPDATE via RLS, using the
 *    same RLS-respecting client this route already uses (createClient(),
 *    not createServiceClient()). The explicit .eq("user_id", user.id) below
 *    is correct regardless — it's defense-in-depth alongside RLS, not the
 *    sole enforcement — but the ownership boundary was never resting on
 *    this route alone the way the old comment implied.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();

    // H2 fix: require authentication
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { notificationId, event } = await req.json() as {
      notificationId: string;
      event: "delivered" | "clicked" | "dismissed";
    };

    if (!notificationId || !["delivered", "clicked", "dismissed"].includes(event)) {
      return NextResponse.json({ error: "Invalid params" }, { status: 400 });
    }

    const column = event === "delivered" ? "delivered_at" : event === "clicked" ? "clicked_at" : "dismissed_at";

    // H2 fix: scope update by BOTH notification id AND authenticated user_id
    await supabase
      .from("notification_logs")
      .update({ [column]: new Date().toISOString() })
      .eq("id", notificationId)
      .eq("user_id", user.id)   // ownership check — cannot update another user's row
      .is(column, null);        // idempotent — only set once

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
