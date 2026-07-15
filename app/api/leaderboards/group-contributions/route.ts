/**
 * app/api/leaderboards/group-contributions/route.ts
 *
 * ?groupId=... (required — this metric only makes sense within a group's
 * shared goals). Count only, never a dollar sum — see 052's file header
 * for why that's a deliberately conservative reading of "never expose
 * financial balances" even though Phase 6 already lets fellow
 * contributors see real amounts on a shared goal's own detail view.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("leaderboards.groupContributions");

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const groupId = req.nextUrl.searchParams.get("groupId");
  if (!groupId) {
    return NextResponse.json({ error: "groupId required" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("leaderboard_group_contributions", { p_group_id: groupId });

  if (error) {
    log.error("leaderboard_group_contributions RPC failed", { user_id: user.id, groupId, error: error.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  return NextResponse.json({ groupId, entries: data ?? [] });
}