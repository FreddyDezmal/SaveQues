/**
 * app/api/groups/list/route.ts
 *
 * "My groups" page in one round trip via public.list_my_groups() (048):
 * active groups with my role + member count, pending invites I've
 * received, pending join requests I've sent.
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("groups.list");

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase.rpc("list_my_groups");

  if (error) {
    log.error("list_my_groups RPC failed", { user_id: user.id, error: error.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  return NextResponse.json(data ?? { groups: [], pending_invites: [], pending_join_requests: [] });
}