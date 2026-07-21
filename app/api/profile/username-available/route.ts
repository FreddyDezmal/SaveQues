/**
 * app/api/profile/username-available/route.ts
 *
 * Live availability check for the signup form and Settings. Deliberately
 * reachable without authentication — a visitor picking a username during
 * signup has no session yet (same reasoning as GET /api/invitations/preview,
 * 053: some checks must work before an account exists).
 *
 * Calls is_username_available() (058_username_onboarding.sql), a
 * SECURITY DEFINER RPC that returns a single boolean and nothing else about
 * any row — profiles' own SELECT RLS (auth.uid() = id) stays untouched and
 * this route never reads a profiles row directly.
 *
 * No rate limiting: this codebase's rate limiter (lib/rateLimit.ts) counts
 * rows keyed on user_id, which doesn't exist for a signed-out caller. Left
 * unlimited deliberately rather than bolting on a parallel IP-based limiter
 * for one endpoint — the RPC does a single indexed lookup, and the only
 * information it leaks is "is this exact string already someone's
 * username," which is the endpoint's whole, necessary purpose (the same
 * trade-off every signup form with a live-username-check makes).
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { isValidUsernameFormat } from "@/lib/username";

const log = createLogger("profile.username-available");

export async function GET(req: NextRequest) {
  const username = req.nextUrl.searchParams.get("username")?.trim() ?? "";

  if (!username) {
    return NextResponse.json({ available: false, reason: "empty" });
  }
  if (!isValidUsernameFormat(username)) {
    return NextResponse.json({
      available: false,
      reason: "format",
      message: "3-20 characters: letters, numbers, and underscores only.",
    });
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc("is_username_available", { p_username: username });

  if (error) {
    log.error("is_username_available RPC failed", { error: error.message });
    return NextResponse.json({ error: "Couldn't check that username right now" }, { status: 500 });
  }

  return NextResponse.json({ available: !!data, reason: data ? undefined : "taken" });
}
