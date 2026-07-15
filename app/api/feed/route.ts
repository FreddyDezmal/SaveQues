/**
 * app/api/feed/route.ts
 *
 * The activity feed via public.get_activity_feed() (051) — cursor
 * pagination via `before` (an ISO timestamp; pass the last item's
 * created_at to get the next page). Every row here came from a trigger
 * reacting to a real state change or the service-role level_up path
 * (051) — there is no create-a-post endpoint, by design.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("feed.list");

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 30, 50) : 30;
  const before = req.nextUrl.searchParams.get("before") || null;

  const { data, error } = await supabase.rpc("get_activity_feed", { p_limit: limit, p_before: before });

  if (error) {
    log.error("get_activity_feed RPC failed", { user_id: user.id, error: error.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  return NextResponse.json({ items: data ?? [] });
}