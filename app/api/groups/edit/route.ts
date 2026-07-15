/**
 * app/api/groups/edit/route.ts
 *
 * Updates a group's editable fields. owner_id is never accepted here —
 * it's immutable at the DB level as of 048, so even if a client sent it
 * this would fail; this route just doesn't offer it as an option.
 * RLS (groups_update_owner_or_admin) already restricts this to the owner
 * or an admin.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("groups.edit");
const VALID_TYPES = ["family", "friends", "university", "roommates", "travel", "wedding", "emergency_fund", "custom"];

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { groupId } = body;
  if (!groupId) {
    return NextResponse.json({ error: "groupId required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.name === "string") {
    const name = body.name.trim().slice(0, 60);
    if (!name) return NextResponse.json({ error: "name can't be empty" }, { status: 400 });
    updates.name = name;
  }
  if (typeof body.description === "string") updates.description = body.description.trim().slice(0, 300) || null;
  if (typeof body.emoji === "string" && body.emoji.length <= 8) updates.emoji = body.emoji;
  if (typeof body.groupType === "string") {
    if (!VALID_TYPES.includes(body.groupType)) {
      return NextResponse.json({ error: "invalid groupType" }, { status: 400 });
    }
    updates.group_type = body.groupType;
  }
  if (typeof body.isActive === "boolean") updates.is_active = body.isActive;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("groups")
    .update(updates)
    .eq("id", groupId)
    .select("id, name, description, emoji, group_type, is_active, xp_total")
    .maybeSingle();

  if (error) {
    log.error("group edit failed", { user_id: user.id, group_id: groupId, error: error.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
  if (!data) {
    // RLS silently filtered the row: either it doesn't exist, or the
    // caller isn't the owner/admin.
    return NextResponse.json({ error: "Not found, or you don't have permission to edit it" }, { status: 404 });
  }

  return NextResponse.json({ success: true, group: data });
}