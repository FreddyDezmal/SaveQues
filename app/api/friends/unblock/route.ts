/**
 * app/api/friends/unblock/route.ts
 *
 * Removes a block. Deletes the row outright rather than resetting it to
 * some other status — an unblock doesn't imply either party wants to be
 * friends again, so there's nothing meaningful for the row to become.
 * RLS (046 friendships_delete_own) already refuses this unless
 * auth.uid() = blocked_by; the explicit check here just gives a clearer
 * error message than a generic RLS failure would.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("friends.unblock");

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
    .select("id, status, blocked_by")
    .eq("id", friendshipId)
    .maybeSingle();

  if (fetchError || !row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (row.status !== "blocked") {
    return NextResponse.json({ error: "This isn't a block" }, { status: 400 });
  }
  if (row.blocked_by !== user.id) {
    return NextResponse.json({ error: "Only the person who blocked can unblock" }, { status: 403 });
  }

  const { error: deleteError } = await supabase.from("friendships").delete().eq("id", friendshipId);
  if (deleteError) {
    log.error("unblock failed", { user_id: user.id, friendship_id: friendshipId, error: deleteError.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}