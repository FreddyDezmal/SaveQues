/**
 * app/api/leaderboards/goals-completed/route.ts
 *
 * ?scope=friends|group (default friends), ?groupId=... (required if group)
 * Count only — never touches target_amount/current_amount.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("leaderboards.goalsCompleted");

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const scope = req.nextUrl.searchParams.get("scope") === "group" ? "group" : "friends";
  const groupId = req.nextUrl.searchParams.get("groupId");

  if (scope === "group" && !groupId) {
    return NextResponse.json({ error: "groupId required when scope=group" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("leaderboard_goals_completed", {
    p_scope: scope,
    p_group_id: scope === "group" ? groupId : null,
  });

  if (error) {
    log.error("leaderboard_goals_completed RPC failed", { user_id: user.id, scope, groupId, error: error.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  return NextResponse.json({ scope, entries: data ?? [] });
}