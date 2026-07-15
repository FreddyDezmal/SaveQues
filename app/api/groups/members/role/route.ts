/**
 * app/api/groups/members/role/route.ts
 *
 * Owner sets a member's role to 'admin' or 'member'. The 048 trigger
 * already restricts this to the owner and refuses 'owner' as a target
 * role (no promoting someone to co-owner) — this route just validates
 * input shape and turns the trigger's exception into a clean response.
 *
 * Sprint 22, Phase 14: rate limited. Not spam-for-profit like an invite
 * or friend request, but a privileged action that could be used to
 * grief members (rapid promote/demote cycling) if a session were
 * compromised — had no limit before this.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkAttemptRateLimit, recordAttempt } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";

const log = createLogger("groups.members.role");
const RATE_LIMIT_ENDPOINT = "groups.members.role";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { memberId, role } = await req.json().catch(() => ({}));
  if (!memberId || (role !== "admin" && role !== "member")) {
    return NextResponse.json({ error: "memberId and role ('admin'|'member') required" }, { status: 400 });
  }

  const limit = await checkAttemptRateLimit(supabase, {
    userId: user.id,
    endpoint: RATE_LIMIT_ENDPOINT,
    windowMinutes: 60,
    maxRequests: 30,
    actionLabel: "role changes",
  });
  await recordAttempt(supabase, user.id, RATE_LIMIT_ENDPOINT);
  if (!limit.allowed) {
    return NextResponse.json({ error: limit.message }, { status: 429 });
  }

  const { error } = await supabase.from("group_members").update({ role }).eq("id", memberId);

  if (error) {
    log.warn("role change failed", { user_id: user.id, member_id: memberId, role, error: error.message });
    return NextResponse.json(
      { error: "Couldn't change that role — only the group owner can do this" },
      { status: 403 }
    );
  }

  return NextResponse.json({ success: true, role });
}