/**
 * app/api/partner/end/route.ts
 *
 * Ends an active accountability partnership, or cancels/declines a
 * pending one (the 047 trigger allows pending→declined from either party,
 * matching "cancel my own request" and "reject someone else's" to the
 * same terminal state). No delete — accountability_partners keeps history
 * by design (045).
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("partner.end");

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { accountabilityId } = await req.json();
  if (!accountabilityId) {
    return NextResponse.json({ error: "accountabilityId required" }, { status: 400 });
  }

  const { data: row, error: fetchError } = await supabase
    .from("accountability_partners")
    .select("id, requester_id, partner_id, status")
    .eq("id", accountabilityId)
    .maybeSingle();

  if (fetchError || !row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (row.requester_id !== user.id && row.partner_id !== user.id) {
    return NextResponse.json({ error: "Not your accountability partnership" }, { status: 403 });
  }
  if (row.status !== "pending" && row.status !== "active") {
    return NextResponse.json({ error: `Already ${row.status}` }, { status: 409 });
  }

  const newStatus = row.status === "pending" ? "declined" : "ended";
  const { error: updateError } = await supabase
    .from("accountability_partners")
    .update({ status: newStatus })
    .eq("id", accountabilityId);

  if (updateError) {
    log.error("partner end failed", { user_id: user.id, accountability_id: accountabilityId, error: updateError.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  return NextResponse.json({ success: true, status: newStatus });
}