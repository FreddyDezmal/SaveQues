import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Soft-deletes either a single notification (`{ id }`), several
 * (`{ ids }`), or all of the current user's non-deleted notifications
 * (`{ all: true }`) — sets deleted_at, never a real row DELETE. See
 * migration 062's header for why: notification_logs is the audit trail
 * of what was actually sent, and that must survive a user clearing their
 * own inbox view.
 *
 * Same conventions as mark-read/archive routes: session client, row
 * scoped by user_id, only ever writes deleted_at.
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
      .update({ deleted_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("deleted_at", null); // idempotent — only ever set once per row

    if (id) {
      query = query.eq("id", id);
    } else if (ids && ids.length > 0) {
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