/**
 * app/api/groups/members/remove/route.ts
 *
 * Removes a member (owner/admin action) or leaves a group (self action) —
 * both go through the same 'active' → 'removed' transition, which the 048
 * trigger allows for either the member themself or an owner/admin, and
 * refuses entirely for the owner's own row.
 *
 * Sprint 22, Phase 14: rate limited. Self-leave is a one-shot action per
 * membership and barely needs it, but the owner/admin-removes-someone-
 * else path is the same kind of griefing-capable privileged action as
 * members/role — had no limit before this.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkAttemptRateLimit, recordAttempt } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";

const log = createLogger("groups.members.remove");
const RATE_LIMIT_ENDPOINT = "groups.members.remove";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { memberId } = await req.json().catch(() => ({}));
  if (!memberId) {
    return NextResponse.json({ error: "memberId required" }, { status: 400 });
  }

  const limit = await checkAttemptRateLimit(supabase, {
    userId: user.id,
    endpoint: RATE_LIMIT_ENDPOINT,
    windowMinutes: 60,
    maxRequests: 30,
    actionLabel: "member removals",
  });
  await recordAttempt(supabase, user.id, RATE_LIMIT_ENDPOINT);
  if (!limit.allowed) {
    return NextResponse.json({ error: limit.message }, { status: 429 });
  }

  const { data: row, error: fetchError } = await supabase
    .from("group_members")
    .select("id, role, status")
    .eq("id", memberId)
    .maybeSingle();

  if (fetchError || !row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (row.role === "owner") {
    return NextResponse.json({ error: "The group owner can't be removed — delete the group instead" }, { status: 400 });
  }
  if (row.status !== "active") {
    return NextResponse.json({ error: `Not an active member (${row.status})` }, { status: 409 });
  }

  const { error: updateError } = await supabase
    .from("group_members")
    .update({ status: "removed" })
    .eq("id", memberId);

  if (updateError) {
    log.warn("member remove failed", { user_id: user.id, member_id: memberId, error: updateError.message });
    return NextResponse.json({ error: "Couldn't remove that member" }, { status: 403 });
  }

  return NextResponse.json({ success: true });
}