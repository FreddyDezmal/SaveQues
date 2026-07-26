import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Archives or unarchives either a single notification (`{ id }`), several
 * (`{ ids }`), or all of the current user's non-archived, non-deleted
 * notifications (`{ all: true }`). Pass `{ archive: false }` to unarchive
 * instead (default true).
 *
 * Mirrors app/api/notifications/mark-read/route.ts's conventions exactly:
 * session client (not service — RLS is the real enforcement, matching
 * that route's own comment), .eq("user_id", user.id) row scoping, only
 * ever writes the one column this route owns.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { id, ids, all, archive } = body as { id?: string; ids?: string[]; all?: boolean; archive?: boolean };
    const archiving = archive !== false; // default true

    if (!id && !all && !(Array.isArray(ids) && ids.length > 0)) {
      return NextResponse.json({ error: "Provide { id }, { ids: string[] }, or { all: true }" }, { status: 400 });
    }

    let query = supabase
      .from("notification_logs")
      .update({ archived_at: archiving ? new Date().toISOString() : null })
      .eq("user_id", user.id)
      .is("deleted_at", null); // a deleted row can't be (un)archived — no user-facing path reaches deleted rows at all

    if (archiving) {
      query = query.is("archived_at", null); // idempotent — only archive what isn't already archived
    } else {
      query = query.not("archived_at", "is", null); // idempotent the other direction — only unarchive what's actually archived
    }

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