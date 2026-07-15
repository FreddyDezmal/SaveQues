/**
 * app/api/achievements/route.ts
 *
 * ?userId=... (defaults to the caller's own achievements if omitted)
 *
 * Sprint 22, Phase 12. The browsable read path "Public achievements"
 * (per-achievement/profile visibility) implies but didn't exist before
 * this phase — achievements previously only ever appeared once,
 * transiently, in the activity feed at the moment they were unlocked
 * (051's feed_on_achievement_unlocked trigger). This is the first
 * standing, visibility-respecting way to actually view a set of
 * achievements. All access control lives in public.get_user_achievements()
 * (054) — see that migration for the two-layer (profile_visibility outer
 * gate, per-achievement inner gate) reasoning.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("achievements.list");

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const targetUserId = req.nextUrl.searchParams.get("userId") || user.id;

  const { data, error } = await supabase.rpc("get_user_achievements", { p_target_user_id: targetUserId });

  if (error) {
    log.error("get_user_achievements RPC failed", { user_id: user.id, target: targetUserId, error: error.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}