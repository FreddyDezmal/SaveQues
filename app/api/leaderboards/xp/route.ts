/**
 * app/api/leaderboards/xp/route.ts
 *
 * ?scope=friends|group  (default friends)
 * ?groupId=...          (required if scope=group)
 * ?period=week|month    (default week)
 *
 * Authorization lives entirely in public.leaderboard_member_set() (052) —
 * this route just passes params through and returns the RPC result.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("leaderboards.xp");

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const scope = req.nextUrl.searchParams.get("scope") === "group" ? "group" : "friends";
  const groupId = req.nextUrl.searchParams.get("groupId");
  const period = req.nextUrl.searchParams.get("period") === "month" ? "month" : "week";

  if (scope === "group" && !groupId) {
    return NextResponse.json({ error: "groupId required when scope=group" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("leaderboard_xp", {
    p_scope: scope,
    p_group_id: scope === "group" ? groupId : null,
    p_period: period,
  });

  if (error) {
    log.error("leaderboard_xp RPC failed", { user_id: user.id, scope, groupId, error: error.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  return NextResponse.json({ scope, period, entries: data ?? [] });
}