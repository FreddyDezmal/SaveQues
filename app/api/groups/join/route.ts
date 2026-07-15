/**
 * app/api/groups/join/route.ts
 *
 * Self-requests to join a group (status='pending_approval', awaiting
 * owner/admin approval). Requires already knowing the group's id — this
 * app doesn't have a public group directory; discovery is via an invite
 * link (Phase 10, not built yet) or being told the id by a member.
 *
 * Same stale-row replacement pattern as /api/groups/invite for a user
 * re-requesting after a past decline/removal.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkAttemptRateLimit, recordAttempt } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";

const log = createLogger("groups.join");
const RATE_LIMIT_ENDPOINT = "groups.join";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { groupId } = await req.json().catch(() => ({}));
  if (!groupId) {
    return NextResponse.json({ error: "groupId required" }, { status: 400 });
  }

  const limit = await checkAttemptRateLimit(supabase, {
    userId: user.id,
    endpoint: RATE_LIMIT_ENDPOINT,
    windowMinutes: 60,
    maxRequests: 20,
    actionLabel: "join requests",
  });
  await recordAttempt(supabase, user.id, RATE_LIMIT_ENDPOINT);
  if (!limit.allowed) {
    return NextResponse.json({ error: limit.message }, { status: 429 });
  }

  const { data: group } = await supabase.from("groups").select("id, is_active").eq("id", groupId).maybeSingle();
  if (!group || !group.is_active) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  const { data: existing, error: fetchError } = await supabase
    .from("group_members")
    .select("id, status")
    .eq("group_id", groupId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (fetchError) {
    log.error("join lookup failed", { user_id: user.id, group_id: groupId, error: fetchError.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  if (existing) {
    if (existing.status === "active") {
      return NextResponse.json({ success: true, alreadyMember: true });
    }
    if (existing.status === "invited") {
      return NextResponse.json({ error: "You already have a pending invite to this group — accept that instead" }, { status: 409 });
    }
    if (existing.status === "pending_approval") {
      return NextResponse.json({ success: true, status: "pending_approval" });
    }
    // removed / declined — replace.
    const { error: deleteError } = await supabase.from("group_members").delete().eq("id", existing.id);
    if (deleteError) {
      log.error("stale member row cleanup failed", { user_id: user.id, error: deleteError.message });
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
  }

  const { error: insertError } = await supabase
    .from("group_members")
    .insert({ group_id: groupId, user_id: user.id, status: "pending_approval" });

  if (insertError) {
    log.warn("join request insert failed", { user_id: user.id, group_id: groupId, error: insertError.message });
    return NextResponse.json({ error: "Couldn't send that request" }, { status: 400 });
  }

  return NextResponse.json({ success: true, status: "pending_approval" });
}