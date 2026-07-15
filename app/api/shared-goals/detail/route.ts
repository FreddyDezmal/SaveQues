/**
 * app/api/shared-goals/detail/route.ts
 *
 * Full detail for one shared goal via public.get_shared_goal_detail()
 * (049) — real target/current amounts, owner + group cards, per-member
 * contribution totals. See that migration's file header for why exposing
 * real amounts here is a deliberate, scoped exception to the feed's
 * no-amounts rule. Returns 404 for both "doesn't exist" and "you can't
 * see this" — the RPC itself doesn't distinguish them.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("sharedGoals.detail");

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sharedGoalId = req.nextUrl.searchParams.get("sharedGoalId");
  if (!sharedGoalId) {
    return NextResponse.json({ error: "sharedGoalId required" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("get_shared_goal_detail", { p_shared_goal_id: sharedGoalId });

  if (error) {
    log.error("get_shared_goal_detail RPC failed", { user_id: user.id, shared_goal_id: sharedGoalId, error: error.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}