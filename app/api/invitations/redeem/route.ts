/**
 * app/api/invitations/redeem/route.ts
 *
 * Requires auth (the new user must have completed signup first — this
 * is the step right after that, typically triggered automatically by the
 * /invite/{token} page once the visitor is signed in). All the real
 * logic — anti-abuse guards, rewards, group auto-join, referral
 * achievements — lives in public.redeem_invite() (053); this route just
 * calls it and passes through the result.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkAttemptRateLimit, recordAttempt } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";

const log = createLogger("invitations.redeem");
const RATE_LIMIT_ENDPOINT = "invitations.redeem";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_or_expired: "This invite link isn't valid or has expired",
  self_referral: "You can't redeem your own invite",
  already_redeemed_another_invite: "You've already used an invite link — each account can only redeem one",
};

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { token } = await req.json().catch(() => ({}));
  if (!token) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }

  const limit = await checkAttemptRateLimit(supabase, {
    userId: user.id,
    endpoint: RATE_LIMIT_ENDPOINT,
    windowMinutes: 60,
    maxRequests: 10,
    actionLabel: "invite redemption attempts",
  });
  await recordAttempt(supabase, user.id, RATE_LIMIT_ENDPOINT);
  if (!limit.allowed) {
    return NextResponse.json({ error: limit.message }, { status: 429 });
  }

  const { data, error } = await supabase.rpc("redeem_invite", { p_token: token });

  if (error) {
    log.error("redeem_invite RPC failed", { user_id: user.id, error: error.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  if (!data.success) {
    return NextResponse.json({ error: ERROR_MESSAGES[data.error] || "Couldn't redeem that invite" }, { status: 400 });
  }

  return NextResponse.json(data);
}