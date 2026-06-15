import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Called by the service worker when a push is received or clicked.
 * The notification ID is stored in the push payload and passed here.
 *
 * Security (H2 fix):
 *  • Requires authentication — unauthenticated requests are rejected with 401.
 *  • Scopes the update to BOTH notification id AND the authenticated user_id,
 *    preventing a user from updating another user's notification log entry.
 *  • RLS on notification_logs only has a SELECT policy (read own); UPDATE/DELETE
 *    are not permitted via RLS at all, so this route is the only write path and
 *    the user_id scope here is the sole ownership enforcement for writes.
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
      event: "delivered" | "clicked";
    };

    if (!notificationId || !["delivered", "clicked"].includes(event)) {
      return NextResponse.json({ error: "Invalid params" }, { status: 400 });
    }

    const column = event === "delivered" ? "delivered_at" : "clicked_at";

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
