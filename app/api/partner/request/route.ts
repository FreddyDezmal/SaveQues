/**
 * app/api/partner/request/route.ts
 *
 * Requests an accountability partner. Simpler than /api/friends/request
 * because the single-partner constraint is enforced by a DB trigger
 * (enforce_single_accountability_partner, 045) rather than needing
 * declined-row-reuse logic — this route mostly just inserts and translates
 * the trigger's exception into a clean 409.
 *
 * One thing it does handle explicitly: if the target already sent the
 * caller a pending request, this accepts it rather than creating a second,
 * mirroring the friend system's mutual-request behavior.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkAttemptRateLimit, recordAttempt } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";
import { sendPartnerRequest, sendPartnerAccepted } from "@/lib/notifications";

const log = createLogger("partner.request");
const RATE_LIMIT_ENDPOINT = "partner.request";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { targetUserId } = await req.json();
  if (!targetUserId || typeof targetUserId !== "string") {
    return NextResponse.json({ error: "targetUserId required" }, { status: 400 });
  }
  if (targetUserId === user.id) {
    return NextResponse.json({ error: "You can't partner with yourself" }, { status: 400 });
  }

  const limit = await checkAttemptRateLimit(supabase, {
    userId: user.id,
    endpoint: RATE_LIMIT_ENDPOINT,
    windowMinutes: 60,
    maxRequests: 10,
    actionLabel: "partner requests",
  });
  await recordAttempt(supabase, user.id, RATE_LIMIT_ENDPOINT);
  if (!limit.allowed) {
    return NextResponse.json({ error: limit.message }, { status: 429 });
  }

  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();
  const callerName = callerProfile?.display_name || "Someone";

  // Mutual case: target already asked us first.
  const { data: reverseRequest } = await supabase
    .from("accountability_partners")
    .select("id")
    .eq("requester_id", targetUserId)
    .eq("partner_id", user.id)
    .eq("status", "pending")
    .maybeSingle();

  if (reverseRequest) {
    const { error: acceptError } = await supabase
      .from("accountability_partners")
      .update({ status: "active" })
      .eq("id", reverseRequest.id);

    if (acceptError) {
      log.error("mutual partner auto-accept failed", { user_id: user.id, error: acceptError.message });
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }

    sendPartnerAccepted(targetUserId, callerName).catch((err) =>
      log.error("sendPartnerAccepted failed", { error: err.message })
    );
    return NextResponse.json({ success: true, status: "active", autoAccepted: true });
  }

  const { error: insertError } = await supabase
    .from("accountability_partners")
    .insert({ requester_id: user.id, partner_id: targetUserId, status: "pending" });

  if (insertError) {
    if (insertError.code === "23505" || insertError.message?.includes("already has a pending or active")) {
      return NextResponse.json(
        { error: "You or they already have a pending or active accountability partner" },
        { status: 409 }
      );
    }
    log.warn("partner request insert failed", { user_id: user.id, target: targetUserId, error: insertError.message });
    return NextResponse.json({ error: "Couldn't send that request" }, { status: 400 });
  }

  sendPartnerRequest(targetUserId, callerName).catch((err) =>
    log.error("sendPartnerRequest failed", { error: err.message })
  );

  return NextResponse.json({ success: true, status: "pending" });
}