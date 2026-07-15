/**
 * app/api/feed/hide/route.ts
 *
 * Deletes one of the caller's own feed entries. RLS (activity_feed_
 * delete_own, 045, unchanged by 051) already restricts this to
 * auth.uid() = actor_id — there's never a reason for anyone else to
 * remove someone else's entry, so this route doesn't accept any
 * "moderate someone else's post" path at all.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("feed.hide");

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { feedItemId } = await req.json().catch(() => ({}));
  if (!feedItemId) {
    return NextResponse.json({ error: "feedItemId required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("activity_feed")
    .delete()
    .eq("id", feedItemId)
    .select("id")
    .maybeSingle();

  if (error) {
    log.error("feed hide failed", { user_id: user.id, feed_item_id: feedItemId, error: error.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found, or it's not yours to hide" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}