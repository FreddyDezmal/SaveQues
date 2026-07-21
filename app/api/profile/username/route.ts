/**
 * app/api/profile/username/route.ts
 *
 * Sets or changes the caller's own username. A plain UPDATE via the
 * request-scoped (RLS-respecting) client is enough here — profiles' own
 * UPDATE policy ("safe columns only", 014_consolidated_schema.sql) already
 * lets a user freely update their own username; only xp_total, streak_days,
 * is_admin, and the quest-completion counters are pinned. No new RPC
 * needed for the write itself (unlike the availability check, which does
 * need one — see username-available/route.ts — because reading someone
 * else's row is what's actually restricted here, not writing your own).
 *
 * Format is validated here too (not just client-side and not just the DB's
 * own profiles_username_format CHECK, 058) so a rejected value gets a
 * clean 400 with a real message instead of a raw Postgres constraint error
 * — the same "first layer of defence, not a replacement for the DB
 * constraint" pattern already used elsewhere in this codebase (e.g.
 * timezone validation).
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkAttemptRateLimit, recordAttempt } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";
import { isValidUsernameFormat } from "@/lib/username";

const log = createLogger("profile.username");
const RATE_LIMIT_ENDPOINT = "profile.username";
const UNIQUE_VIOLATION = "23505";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { username } = await req.json().catch(() => ({}));
  if (typeof username !== "string" || !isValidUsernameFormat(username)) {
    return NextResponse.json(
      { error: "Username must be 3-20 characters: letters, numbers, and underscores only." },
      { status: 400 }
    );
  }

  const limit = await checkAttemptRateLimit(supabase, {
    userId: user.id,
    endpoint: RATE_LIMIT_ENDPOINT,
    windowMinutes: 60,
    maxRequests: 10,
    actionLabel: "username changes",
  });
  await recordAttempt(supabase, user.id, RATE_LIMIT_ENDPOINT);
  if (!limit.allowed) {
    return NextResponse.json({ error: limit.message }, { status: 429 });
  }

  const { error } = await supabase.from("profiles").update({ username }).eq("id", user.id);

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return NextResponse.json({ error: "That username is already taken." }, { status: 409 });
    }
    log.error("username update failed", { user_id: user.id, error: error.message });
    return NextResponse.json({ error: "Couldn't save that username right now" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, username });
}
