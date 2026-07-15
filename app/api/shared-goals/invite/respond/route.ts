/**
 * app/api/shared-goals/invite/respond/route.ts
 *
 * Invited user accepts or declines. The 049 trigger already restricts
 * this to the invited user_id; this route's checks give a clean error.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("sharedGoals.invite.respond");

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { memberId, action } = await req.json().catch(() => ({}));
  if (!memberId || (action !== "accept" && action !== "decline")) {
    return NextResponse.json({ error: "memberId and action ('accept'|'decline') required" }, { status: 400 });
  }

  const { data: row, error: fetchError } = await supabase
    .from("shared_goal_members")
    .select("id, user_id, status")
    .eq("id", memberId)
    .maybeSingle();

  if (fetchError || !row) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }
  if (row.user_id !== user.id) {
    return NextResponse.json({ error: "This isn't your invite to respond to" }, { status: 403 });
  }
  if (row.status !== "invited") {
    return NextResponse.json({ error: `Already ${row.status}` }, { status: 409 });
  }

  const newStatus = action === "accept" ? "active" : "declined";
  const { error: updateError } = await supabase
    .from("shared_goal_members")
    .update({ status: newStatus })
    .eq("id", memberId);

  if (updateError) {
    log.error("shared goal invite response failed", { user_id: user.id, member_id: memberId, error: updateError.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  return NextResponse.json({ success: true, status: newStatus });
}