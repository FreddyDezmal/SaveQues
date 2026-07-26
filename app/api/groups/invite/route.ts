/**
 * app/api/groups/invite/route.ts
 *
 * Owner/admin invites a user to the group. Handles the case where a
 * group_members row already exists for that user from a past
 * removed/declined membership: UNIQUE(group_id, user_id) means it can't
 * just be re-inserted, and the 048 transition trigger doesn't allow
 * removed/declined → invited (that's a deliberately narrow transition
 * graph, not an oversight) — so a stale non-owner row is deleted and
 * replaced, the same pattern /api/friends/request uses for a declined
 * friendship. RLS (group_members_delete_self_or_admin, 048) already
 * refuses to delete an owner row, so this can never accidentally clear
 * the group's owner.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkAttemptRateLimit, recordAttempt } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";
import { sendGroupInvite } from "@/lib/notifications";

const log = createLogger("groups.invite");
const RATE_LIMIT_ENDPOINT = "groups.invite";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { groupId, targetUserId } = await req.json().catch(() => ({}));
  if (!groupId || !targetUserId) {
    return NextResponse.json({ error: "groupId and targetUserId required" }, { status: 400 });
  }

  const limit = await checkAttemptRateLimit(supabase, {
    userId: user.id,
    endpoint: RATE_LIMIT_ENDPOINT,
    windowMinutes: 60,
    maxRequests: 30,
    actionLabel: "group invites",
  });
  await recordAttempt(supabase, user.id, RATE_LIMIT_ENDPOINT);
  if (!limit.allowed) {
    return NextResponse.json({ error: limit.message }, { status: 429 });
  }

  const { data: existing, error: fetchError } = await supabase
    .from("group_members")
    .select("id, status, role")
    .eq("group_id", groupId)
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (fetchError) {
    log.error("invite lookup failed", { user_id: user.id, group_id: groupId, error: fetchError.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  if (existing) {
    if (existing.status === "active" || existing.status === "invited" || existing.status === "pending_approval") {
      return NextResponse.json({ error: `Already ${existing.status === "active" ? "a member" : existing.status}` }, { status: 409 });
    }
    // removed / declined — replace the stale row. RLS refuses this delete
    // outright if existing.role were somehow 'owner', which can't happen
    // here anyway since the owner's row is never removed/declined.
    const { error: deleteError } = await supabase.from("group_members").delete().eq("id", existing.id);
    if (deleteError) {
      log.error("stale member row cleanup failed", { user_id: user.id, error: deleteError.message });
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
  }

  const { error: insertError } = await supabase
    .from("group_members")
    .insert({ group_id: groupId, user_id: targetUserId, status: "invited", invited_by: user.id });

  if (insertError) {
    log.warn("group invite insert failed", { user_id: user.id, group_id: groupId, target: targetUserId, error: insertError.message });
    return NextResponse.json({ error: "Couldn't send that invite" }, { status: 400 });
  }

  const [{ data: inviterProfile }, { data: group }] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", user.id).single(),
    supabase.from("groups").select("name").eq("id", groupId).single(),
  ]);
  sendGroupInvite(targetUserId, inviterProfile?.display_name || "Someone", group?.name || "a group", groupId).catch((err) =>
    log.error("sendGroupInvite failed", { error: err.message })
  );

  return NextResponse.json({ success: true });
}