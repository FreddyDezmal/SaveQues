/**
 * app/api/group-quests/list/route.ts
 *
 * Lists quests for a group — plain table SELECT, RLS (group_quests_
 * select_member, 045) already restricts this to active group members.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("groupQuests.list");

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const groupId = req.nextUrl.searchParams.get("groupId");
  if (!groupId) {
    return NextResponse.json({ error: "groupId required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("group_quests")
    .select("id, quest_type, title, description, target_value, xp_reward, start_date, end_date, status, completed_at, created_at")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });

  if (error) {
    log.error("group quest list failed", { user_id: user.id, group_id: groupId, error: error.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  return NextResponse.json({ quests: data ?? [] });
}