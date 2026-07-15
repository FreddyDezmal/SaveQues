/**
 * app/api/invitations/list/route.ts
 *
 * The caller's own sent invites — RLS (invitations_select_own, 053)
 * already restricts this to auth.uid() = inviter_id. Never returns
 * anyone else's invites, including for a group the caller owns (each
 * inviter only sees invites they personally created).
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("invitations.list");

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("invitations")
    .select("id, invite_type, email, token, context_type, group_id, status, redeemed_by, redeemed_at, expires_at, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    log.error("invitations list failed", { user_id: user.id, error: error.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  return NextResponse.json({ invitations: data ?? [] });
}