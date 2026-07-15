/**
 * app/api/groups/join/respond/route.ts
 *
 * Owner/admin approves or declines a pending join request. The 048
 * trigger already refuses this from anyone but the owner/an admin; this
 * route's checks exist for a clean error response.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("groups.join.respond");

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { memberId, action } = await req.json().catch(() => ({}));
  if (!memberId || (action !== "approve" && action !== "decline")) {
    return NextResponse.json({ error: "memberId and action ('approve'|'decline') required" }, { status: 400 });
  }

  const { data: row, error: fetchError } = await supabase
    .from("group_members")
    .select("id, group_id, status")
    .eq("id", memberId)
    .maybeSingle();

  if (fetchError || !row) {
    return NextResponse.json({ error: "Join request not found" }, { status: 404 });
  }
  if (row.status !== "pending_approval") {
    return NextResponse.json({ error: `Already ${row.status}` }, { status: 409 });
  }

  const newStatus = action === "approve" ? "active" : "declined";
  const { error: updateError } = await supabase
    .from("group_members")
    .update({ status: newStatus })
    .eq("id", memberId);

  if (updateError) {
    // Most likely cause: caller isn't the owner/admin — the 048 trigger
    // raised insufficient_privilege, which RLS/postgrest surfaces here as
    // a generic update failure rather than a distinguishable error code.
    log.warn("join response failed", { user_id: user.id, member_id: memberId, error: updateError.message });
    return NextResponse.json({ error: "Couldn't respond to that request — you may not have permission" }, { status: 403 });
  }

  return NextResponse.json({ success: true, status: newStatus });
}