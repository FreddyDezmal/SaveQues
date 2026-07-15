/**
 * app/api/groups/members/route.ts
 *
 * Roster for a group, via public.get_group_members() (048). Returns an
 * empty array rather than a 403 for non-members — the RPC deliberately
 * doesn't distinguish "not a member" from "group doesn't exist" so this
 * endpoint can't be used to enumerate group existence/membership.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("groups.members");

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const groupId = req.nextUrl.searchParams.get("groupId");
  if (!groupId) {
    return NextResponse.json({ error: "groupId required" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("get_group_members", { p_group_id: groupId });

  if (error) {
    log.error("get_group_members RPC failed", { user_id: user.id, group_id: groupId, error: error.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  return NextResponse.json({ members: data ?? [] });
}