/**
 * app/api/achievements/visibility/route.ts
 *
 * Sets (or clears, with visibility: null) a per-achievement visibility
 * override on one of the caller's own earned achievements. Falls back to
 * profiles.activity_visibility (the "Public achievements" style default)
 * when no override is set — see get_user_achievements() (054).
 *
 * user_achievements' RLS is `FOR ALL USING (auth.uid() = user_id)` (014)
 * with no column lock, so a plain client-side update already works —
 * this route exists for input validation and a consistent response
 * shape, same reason /api/profile and /api/goal/edit exist despite RLS
 * already technically allowing the underlying write.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("achievements.visibility");
const VALID_VISIBILITY = ["private", "friends", "groups", "public"];

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { achievementId } = body;
  if (!achievementId || typeof achievementId !== "string") {
    return NextResponse.json({ error: "achievementId required" }, { status: 400 });
  }

  // null explicitly clears the override (falls back to the profile
  // default); omitting the field entirely is a no-op error, not treated
  // the same as null, so a client can't accidentally clear an override
  // by forgetting to send the field.
  if (!("visibility" in body)) {
    return NextResponse.json({ error: "visibility required (one of private/friends/groups/public, or null to clear)" }, { status: 400 });
  }
  const visibility = body.visibility;
  if (visibility !== null && !VALID_VISIBILITY.includes(visibility)) {
    return NextResponse.json({ error: `visibility must be one of: ${VALID_VISIBILITY.join(", ")}, or null` }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("user_achievements")
    .update({ visibility })
    .eq("user_id", user.id)
    .eq("achievement_id", achievementId)
    .select("achievement_id, visibility")
    .maybeSingle();

  if (error) {
    log.error("achievement visibility update failed", { user_id: user.id, achievement_id: achievementId, error: error.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "You haven't earned that achievement" }, { status: 404 });
  }

  return NextResponse.json({ success: true, achievement: data });
}