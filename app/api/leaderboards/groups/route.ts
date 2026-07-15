/**
 * app/api/leaderboards/groups/route.ts
 *
 * Ranks the caller's own groups against each other by xp_total (055/045's
 * increment_group_xp, driven by group quest completions, 050). Distinct
 * from the group-scoped member leaderboards above — this compares GROUPS,
 * not people within one group.
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("leaderboards.groups");

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase.rpc("leaderboard_my_groups");

  if (error) {
    log.error("leaderboard_my_groups RPC failed", { user_id: user.id, error: error.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  return NextResponse.json({ entries: data ?? [] });
}