/**
 * app/api/groups/create/route.ts
 *
 * Creates a group. The owner's own group_members row (role='owner',
 * status='active') is seeded automatically by the on_group_created
 * trigger (045) — this route does not, and should not, insert it itself.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkAttemptRateLimit, recordAttempt } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";

const log = createLogger("groups.create");
const RATE_LIMIT_ENDPOINT = "groups.create";
const VALID_TYPES = ["family", "friends", "university", "roommates", "travel", "wedding", "emergency_fund", "custom"];

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 300) : null;
  const emoji = typeof body.emoji === "string" && body.emoji.length <= 8 ? body.emoji : "👥";
  const groupType = VALID_TYPES.includes(body.groupType) ? body.groupType : "custom";

  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  const limit = await checkAttemptRateLimit(supabase, {
    userId: user.id,
    endpoint: RATE_LIMIT_ENDPOINT,
    windowMinutes: 60,
    maxRequests: 10,
    actionLabel: "groups created",
  });
  await recordAttempt(supabase, user.id, RATE_LIMIT_ENDPOINT);
  if (!limit.allowed) {
    return NextResponse.json({ error: limit.message }, { status: 429 });
  }

  const { data, error } = await supabase
    .from("groups")
    .insert({ name, description, emoji, group_type: groupType, owner_id: user.id })
    .select("id, name, description, emoji, group_type, is_active, xp_total, created_at")
    .single();

  if (error) {
    log.error("group create failed", { user_id: user.id, error: error.message });
    return NextResponse.json({ error: "Couldn't create that group" }, { status: 400 });
  }

  return NextResponse.json({ success: true, group: data });
}