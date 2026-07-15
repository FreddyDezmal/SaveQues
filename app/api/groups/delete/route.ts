/**
 * app/api/groups/delete/route.ts
 *
 * Deletes a group outright — owner only (groups_delete_owner_only, 045).
 * Cascades: group_members, group_quests, activity_feed rows for this
 * group are deleted (ON DELETE CASCADE); shared_goals.group_id is set to
 * NULL rather than deleting the shared goal itself, since the underlying
 * savings_goals row and its owner's real money are untouched by any of
 * this — only the group link is severed.
 *
 * Sprint 22, Phase 14: rate limited. This is an irreversible, cascading
 * destructive action that had no rate limit at all — cheap insurance
 * against a compromised session or a buggy client retrying it rapidly,
 * same reasoning applied to shared-goals/unshare below.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkAttemptRateLimit, recordAttempt } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";

const log = createLogger("groups.delete");
const RATE_LIMIT_ENDPOINT = "groups.delete";

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
    maxRequests: 5,
    actionLabel: "group deletions",
  });
  await recordAttempt(supabase, user.id, RATE_LIMIT_ENDPOINT);
  if (!limit.allowed) {
    return NextResponse.json({ error: limit.message }, { status: 429 });
  }

  const { data, error } = await supabase.from("groups").delete().eq("id", groupId).select("id").maybeSingle();

  if (error) {
    log.error("group delete failed", { user_id: user.id, group_id: groupId, error: error.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found, or you're not the owner" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}