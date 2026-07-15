/**
 * app/api/friends/remove/route.ts
 *
 * Removes an accepted friendship, or cancels a pending request in either
 * direction (declining someone else's request, or withdrawing your own).
 *
 * NOT for blocked rows — the 046 DELETE policy already refuses those
 * unless the caller is blocked_by, but this route checks explicitly first
 * so the client gets "use unblock instead" rather than an opaque RLS
 * failure.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("friends.remove");

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { friendshipId } = await req.json();
  if (!friendshipId) {
    return NextResponse.json({ error: "friendshipId required" }, { status: 400 });
  }

  const { data: row, error: fetchError } = await supabase
    .from("friendships")
    .select("id, requester_id, addressee_id, status")
    .eq("id", friendshipId)
    .maybeSingle();

  if (fetchError || !row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (row.requester_id !== user.id && row.addressee_id !== user.id) {
    return NextResponse.json({ error: "Not your friendship to remove" }, { status: 403 });
  }
  if (row.status === "blocked") {
    return NextResponse.json({ error: "This is a block, not a friendship — use unblock instead" }, { status: 400 });
  }

  const { error: deleteError } = await supabase.from("friendships").delete().eq("id", friendshipId);
  if (deleteError) {
    log.error("friend remove failed", { user_id: user.id, friendship_id: friendshipId, error: deleteError.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}