/**
 * app/api/friends/request/route.ts
 *
 * Sends a friend request. Handles three cases beyond the plain new-request
 * path, all driven by looking at any existing friendships row between the
 * two users first (the unconditional unique-pair index from 045 means
 * there can never be more than one):
 *
 *  • Existing 'blocked' row       → 403, generic message (never reveals
 *                                    which side blocked, or that a block
 *                                    exists at all, beyond "can't send").
 *  • Existing 'accepted' row      → idempotent success, alreadyFriends.
 *  • Existing 'pending', caller
 *    is the original requester   → idempotent success, alreadyRequested.
 *  • Existing 'pending', caller
 *    is the original addressee   → the OTHER person already asked first;
 *                                    treat this as acceptance rather than
 *                                    making the user separately visit a
 *                                    "requests" screen to accept.
 *  • Existing 'declined', caller
 *    is the original requester   → re-send (status back to 'pending').
 *    requester_id/addressee_id are immutable on UPDATE (046), so if the
 *    caller was the original ADDRESSEE of a declined row, they can't just
 *    flip direction via UPDATE — delete the stale row and insert fresh
 *    instead, both allowed by RLS for a non-blocked row they're part of.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkAttemptRateLimit, recordAttempt } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";
import { sendFriendRequest, sendFriendAccepted } from "@/lib/notifications";

const log = createLogger("friends.request");
const RATE_LIMIT_ENDPOINT = "friends.request";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { targetUserId } = await req.json();
  if (!targetUserId || typeof targetUserId !== "string") {
    return NextResponse.json({ error: "targetUserId required" }, { status: 400 });
  }
  if (targetUserId === user.id) {
    return NextResponse.json({ error: "You can't friend yourself" }, { status: 400 });
  }

  const limit = await checkAttemptRateLimit(supabase, {
    userId: user.id,
    endpoint: RATE_LIMIT_ENDPOINT,
    windowMinutes: 60,
    maxRequests: 20,
    actionLabel: "friend requests",
  });
  await recordAttempt(supabase, user.id, RATE_LIMIT_ENDPOINT);
  if (!limit.allowed) {
    return NextResponse.json({ error: limit.message }, { status: 429 });
  }

  const { data: callerProfile } = await supabase.from("profiles").select("display_name").eq("id", user.id).single();
  const callerName = callerProfile?.display_name || "Someone";

  const { data: existing, error: fetchError } = await supabase
    .from("friendships")
    .select("id, requester_id, addressee_id, status")
    .or(
      `and(requester_id.eq.${user.id},addressee_id.eq.${targetUserId}),` +
      `and(requester_id.eq.${targetUserId},addressee_id.eq.${user.id})`
    )
    .maybeSingle();

  if (fetchError) {
    log.error("friend request lookup failed", { user_id: user.id, error: fetchError.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  if (!existing) {
    const { error: insertError } = await supabase
      .from("friendships")
      .insert({ requester_id: user.id, addressee_id: targetUserId, status: "pending" });

    if (insertError) {
      log.warn("friend request insert failed", { user_id: user.id, target: targetUserId, error: insertError.message });
      return NextResponse.json({ error: "Couldn't send that request" }, { status: 400 });
    }
    sendFriendRequest(targetUserId, callerName).catch((err) => log.error("sendFriendRequest failed", { error: err.message }));
    return NextResponse.json({ success: true, status: "pending" });
  }

  if (existing.status === "blocked") {
    // Deliberately generic — don't confirm a block exists or which side.
    return NextResponse.json({ error: "Couldn't send that request" }, { status: 403 });
  }

  if (existing.status === "accepted") {
    return NextResponse.json({ success: true, alreadyFriends: true });
  }

  if (existing.status === "pending") {
    if (existing.requester_id === user.id) {
      return NextResponse.json({ success: true, alreadyRequested: true });
    }
    // The other person already requested us — accept it.
    const { error: acceptError } = await supabase
      .from("friendships")
      .update({ status: "accepted", responded_at: new Date().toISOString() })
      .eq("id", existing.id);

    if (acceptError) {
      log.error("mutual-request auto-accept failed", { user_id: user.id, error: acceptError.message });
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
    sendFriendAccepted(existing.requester_id, callerName).catch((err) => log.error("sendFriendAccepted failed", { error: err.message }));
    return NextResponse.json({ success: true, status: "accepted", autoAccepted: true });
  }

  // status === 'declined'
  if (existing.requester_id === user.id) {
    const { error: resendError } = await supabase
      .from("friendships")
      .update({ status: "pending", responded_at: null })
      .eq("id", existing.id);

    if (resendError) {
      log.error("friend re-request failed", { user_id: user.id, error: resendError.message });
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
    sendFriendRequest(targetUserId, callerName).catch((err) => log.error("sendFriendRequest failed", { error: err.message }));
    return NextResponse.json({ success: true, status: "pending" });
  }

  // Caller was the original addressee of a declined row and now wants to
  // be the requester — direction can't change via UPDATE, so replace the row.
  const { error: deleteError } = await supabase.from("friendships").delete().eq("id", existing.id);
  if (deleteError) {
    log.error("stale declined row cleanup failed", { user_id: user.id, error: deleteError.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
  const { error: reInsertError } = await supabase
    .from("friendships")
    .insert({ requester_id: user.id, addressee_id: targetUserId, status: "pending" });
  if (reInsertError) {
    log.error("friend request re-insert after decline failed", { user_id: user.id, error: reInsertError.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
  sendFriendRequest(targetUserId, callerName).catch((err) => log.error("sendFriendRequest failed", { error: err.message }));
  return NextResponse.json({ success: true, status: "pending" });
}