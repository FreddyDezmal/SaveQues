/**
 * app/api/friends/list/route.ts
 *
 * Friends page data in one round trip via public.list_friends() (046) —
 * accepted friends, pending incoming, pending outgoing — rather than the
 * route making a separate query per section (or, worse, a query per
 * friend to fetch their profile card).
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("friends.list");

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase.rpc("list_friends");

  if (error) {
    log.error("list_friends RPC failed", { user_id: user.id, error: error.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  return NextResponse.json(data ?? { friends: [], pending_incoming: [], pending_outgoing: [] });
}