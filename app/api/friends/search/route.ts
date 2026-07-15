/**
 * app/api/friends/search/route.ts
 *
 * Typeahead search for users by username or display name.
 *
 * Security guarantees:
 *  • Auth required             — 401 if not signed in.
 *  • No profiles table exposure — reads go through public.search_users(),
 *    a SECURITY DEFINER RPC that returns an explicit safe-column allowlist.
 *    profiles' own RLS (auth.uid() = id) is untouched.
 *  • Privacy respected         — search_users() excludes 'private' profiles
 *    and anyone on either side of a block with the caller.
 *  • Rate limited              — 30 searches per rolling 5 minutes. This is
 *    the highest-risk endpoint in the friend system for enumeration (an
 *    attacker probing which usernames exist), so it gets a tighter window
 *    than the write endpoints below.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkAttemptRateLimit, recordAttempt } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";

const log = createLogger("friends.search");
const RATE_LIMIT_ENDPOINT = "friends.search";

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const limit = await checkAttemptRateLimit(supabase, {
    userId: user.id,
    endpoint: RATE_LIMIT_ENDPOINT,
    windowMinutes: 5,
    maxRequests: 30,
    actionLabel: "searches",
  });
  await recordAttempt(supabase, user.id, RATE_LIMIT_ENDPOINT);

  if (!limit.allowed) {
    return NextResponse.json({ error: limit.message }, { status: 429 });
  }

  const { data, error } = await supabase.rpc("search_users", {
    p_query: q,
    p_limit: 20,
  });

  if (error) {
    log.error("search_users RPC failed", { user_id: user.id, error: error.message });
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }

  return NextResponse.json({ results: data ?? [] });
}