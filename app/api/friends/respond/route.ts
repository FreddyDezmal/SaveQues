/**
 * app/api/friends/respond/route.ts
 *
 * Accept or decline a pending incoming friend request.
 *
 * RLS already guarantees only the addressee can meaningfully act (the
 * update-immutability policy in 046 means requester_id/addressee_id can't
 * be repointed either), but this route still explicitly checks status and
 * addressee_id so callers get a clear 403/409 instead of a silent no-op
 * from an update that matched zero rows.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { sendFriendAccepted } from "@/lib/notifications";

const log = createLogger("friends.respond");

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { friendshipId, action } = await req.json();
  if (!friendshipId || (action !== "accept" && action !== "decline")) {
    return NextResponse.json({ error: "friendshipId and action ('accept'|'decline') required" }, { status: 400 });
  }

  const { data: row, error: fetchError } = await supabase
    .from("friendships")
    .select("id, requester_id, addressee_id, status")
    .eq("id", friendshipId)
    .maybeSingle();

  if (fetchError || !row) {
    return NextResponse.json({ error: "Friend request not found" }, { status: 404 });
  }
  if (row.addressee_id !== user.id) {
    return NextResponse.json({ error: "Only the recipient can respond to this request" }, { status: 403 });
  }
  if (row.status !== "pending") {
    return NextResponse.json({ error: `This request is already ${row.status}` }, { status: 409 });
  }

  const newStatus = action === "accept" ? "accepted" : "declined";
  const { error: updateError } = await supabase
    .from("friendships")
    .update({ status: newStatus, responded_at: new Date().toISOString() })
    .eq("id", friendshipId);

  if (updateError) {
    log.error("friend response update failed", { user_id: user.id, friendship_id: friendshipId, error: updateError.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  if (newStatus === "accepted") {
    const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", user.id).single();
    sendFriendAccepted(row.requester_id, profile?.display_name || "Someone").catch((err) =>
      log.error("sendFriendAccepted failed", { error: err.message })
    );
  }

  return NextResponse.json({ success: true, status: newStatus });
}