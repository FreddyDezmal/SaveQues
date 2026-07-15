/**
 * app/api/friends/block/route.ts
 *
 * Blocks a user. Works whether or not a friendships row already exists
 * between the two:
 *  • No row yet         → insert directly with status='blocked' (RLS 046
 *                          explicitly allows 'blocked' as an insert status,
 *                          unlike 'accepted'/'declined').
 *  • Existing row        → update to 'blocked'. The 046 trigger stamps
 *                          blocked_by = auth.uid() automatically; the
 *                          update-immutability policy still protects
 *                          requester_id/addressee_id during this update.
 *
 * Rate limited for the same enumeration/abuse reasons as friends/request.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkAttemptRateLimit, recordAttempt } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";

const log = createLogger("friends.block");
const RATE_LIMIT_ENDPOINT = "friends.block";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { targetUserId } = await req.json();
  if (!targetUserId || typeof targetUserId !== "string") {
    return NextResponse.json({ error: "targetUserId required" }, { status: 400 });
  }
  if (targetUserId === user.id) {
    return NextResponse.json({ error: "You can't block yourself" }, { status: 400 });
  }

  const limit = await checkAttemptRateLimit(supabase, {
    userId: user.id,
    endpoint: RATE_LIMIT_ENDPOINT,
    windowMinutes: 60,
    maxRequests: 20,
    actionLabel: "blocks",
  });
  await recordAttempt(supabase, user.id, RATE_LIMIT_ENDPOINT);
  if (!limit.allowed) {
    return NextResponse.json({ error: limit.message }, { status: 429 });
  }

  const { data: existing, error: fetchError } = await supabase
    .from("friendships")
    .select("id, status, blocked_by")
    .or(
      `and(requester_id.eq.${user.id},addressee_id.eq.${targetUserId}),` +
      `and(requester_id.eq.${targetUserId},addressee_id.eq.${user.id})`
    )
    .maybeSingle();

  if (fetchError) {
    log.error("block lookup failed", { user_id: user.id, error: fetchError.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  if (existing?.status === "blocked") {
    return NextResponse.json({ success: true, alreadyBlocked: true });
  }

  if (existing) {
    const { error: updateError } = await supabase
      .from("friendships")
      .update({ status: "blocked" })
      .eq("id", existing.id);
    if (updateError) {
      log.error("block update failed", { user_id: user.id, error: updateError.message });
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
  } else {
    const { error: insertError } = await supabase
      .from("friendships")
      .insert({ requester_id: user.id, addressee_id: targetUserId, status: "blocked" });
    if (insertError) {
      log.error("block insert failed", { user_id: user.id, error: insertError.message });
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}