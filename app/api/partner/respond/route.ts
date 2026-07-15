/**
 * app/api/partner/respond/route.ts
 *
 * Accept or decline a pending accountability partner request. The 047
 * trigger (enforce_accountability_transition) already refuses an accept
 * from anyone but the invited partner_id — this route's explicit check
 * exists to return a clear 403 instead of surfacing that as a raw
 * Postgres exception to the client.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { sendPartnerAccepted } from "@/lib/notifications";

const log = createLogger("partner.respond");

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { accountabilityId, action } = await req.json();
  if (!accountabilityId || (action !== "accept" && action !== "decline")) {
    return NextResponse.json({ error: "accountabilityId and action ('accept'|'decline') required" }, { status: 400 });
  }

  const { data: row, error: fetchError } = await supabase
    .from("accountability_partners")
    .select("id, requester_id, partner_id, status")
    .eq("id", accountabilityId)
    .maybeSingle();

  if (fetchError || !row) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  if (row.partner_id !== user.id) {
    return NextResponse.json({ error: "Only the invited partner can respond to this request" }, { status: 403 });
  }
  if (row.status !== "pending") {
    return NextResponse.json({ error: `This request is already ${row.status}` }, { status: 409 });
  }

  const newStatus = action === "accept" ? "active" : "declined";
  const { error: updateError } = await supabase
    .from("accountability_partners")
    .update({ status: newStatus })
    .eq("id", accountabilityId);

  if (updateError) {
    log.error("partner response update failed", { user_id: user.id, accountability_id: accountabilityId, error: updateError.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  if (newStatus === "active") {
    const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", user.id).single();
    sendPartnerAccepted(row.requester_id, profile?.display_name || "Someone").catch((err) =>
      log.error("sendPartnerAccepted failed", { error: err.message })
    );
  }

  return NextResponse.json({ success: true, status: newStatus });
}