/**
 * app/api/partner/nudge/route.ts
 *
 * Sends an encouragement nudge to the caller's active accountability
 * partner. Rate limited to 3/day per user — a nudge is a push straight to
 * another person's phone, so this is one of the more abuse-sensitive
 * endpoints in the social system despite being "just encouragement".
 *
 * Unlike the fire-and-forget sends in partner/request and partner/respond
 * (mirroring the existing achievement/milestone pattern of never letting a
 * push send add latency to the action that triggered it), this route
 * awaits the send — the nudge IS the entire point of the request, so the
 * caller needs to know whether it actually went anywhere.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkAttemptRateLimit, recordAttempt } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";
import { sendPartnerNudge } from "@/lib/notifications";

const log = createLogger("partner.nudge");
const RATE_LIMIT_ENDPOINT = "partner.nudge";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 200) : undefined;

  const limit = await checkAttemptRateLimit(supabase, {
    userId: user.id,
    endpoint: RATE_LIMIT_ENDPOINT,
    windowMinutes: 1440,
    maxRequests: 3,
    actionLabel: "nudges",
  });
  await recordAttempt(supabase, user.id, RATE_LIMIT_ENDPOINT);
  if (!limit.allowed) {
    return NextResponse.json({ error: limit.message }, { status: 429 });
  }

  const { data: partnerRow, error: fetchError } = await supabase
    .from("accountability_partners")
    .select("requester_id, partner_id")
    .eq("status", "active")
    .or(`requester_id.eq.${user.id},partner_id.eq.${user.id}`)
    .maybeSingle();

  if (fetchError) {
    log.error("nudge partner lookup failed", { user_id: user.id, error: fetchError.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
  if (!partnerRow) {
    return NextResponse.json({ error: "You don't have an accountability partner right now" }, { status: 400 });
  }

  const partnerId = partnerRow.requester_id === user.id ? partnerRow.partner_id : partnerRow.requester_id;

  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  const result = await sendPartnerNudge(partnerId, callerProfile?.display_name || "Your partner", message);

  return NextResponse.json({ success: true, delivered: result.sent > 0 });
}