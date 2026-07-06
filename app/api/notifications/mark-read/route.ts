import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Marks either a single notification (`{ id }`) or all of the current
 * user's unread notifications (`{ all: true }`) as read.
 *
 * Ownership + column scope, matching the existing
 * app/api/notifications/track/route.ts convention exactly:
 *   - .eq("user_id", user.id) scopes which ROWS can be touched (also now
 *     backed by the new notification_logs_update_own_read_state RLS policy
 *     from this sprint's migration — belt-and-suspenders, not redundant:
 *     RLS is the real enforcement even if someone modifies this route
 *     later and forgets to add the .eq()).
 *   - Only `read_at` is ever written here — never title/body/sent_at/type,
 *     which are the immutable audit trail of what was actually sent.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { id, ids, all } = body as { id?: string; ids?: string[]; all?: boolean };

    if (!id && !all && !(Array.isArray(ids) && ids.length > 0)) {
      return NextResponse.json({ error: "Provide { id }, { ids: string[] }, or { all: true }" }, { status: 400 });
    }

    let query = supabase
      .from("notification_logs")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("read_at", null); // idempotent — only ever set once per row

    if (id) {
      query = query.eq("id", id);
    } else if (ids && ids.length > 0) {
      // Sprint 16, Phase 2: lets NotificationCenter mark an entire grouped
      // row (e.g. "3 new quest reminders") read in one request instead of
      // firing N separate mark-read calls.
      query = query.in("id", ids);
    }

    const { error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
