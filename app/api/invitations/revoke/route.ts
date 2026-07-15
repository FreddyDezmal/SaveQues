/**
 * app/api/invitations/revoke/route.ts
 *
 * Revokes an unused invite. RLS (invitations_update_own_status_only, 053)
 * already refuses this once redeemed_by is set — you can't revoke
 * something already redeemed, and inviter_id/token are immutable through
 * that same policy.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("invitations.revoke");

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { invitationId } = await req.json().catch(() => ({}));
  if (!invitationId) {
    return NextResponse.json({ error: "invitationId required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("invitations")
    .update({ status: "revoked" })
    .eq("id", invitationId)
    .select("id")
    .maybeSingle();

  if (error) {
    log.warn("invite revoke failed", { user_id: user.id, invitation_id: invitationId, error: error.message });
    return NextResponse.json({ error: "Couldn't revoke that invite — it may already be redeemed" }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found, or it's not yours" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}