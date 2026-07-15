/**
 * app/api/invitations/preview/route.ts
 *
 * Deliberately does NOT require authentication — this is what a brand
 * new visitor hits before they've signed up, landing on /invite/{token}.
 * public.get_invite_preview() (053) returns only a narrow, safe subset
 * (inviter display name/avatar, group name) and NULL for any invalid,
 * expired, revoked, or already-redeemed token, without distinguishing
 * which — so this can't be used to probe an invite's state.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("invitations.preview");

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_invite_preview", { p_token: token });

  if (error) {
    log.error("get_invite_preview RPC failed", { error: error.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "This invite link isn't valid or has expired" }, { status: 404 });
  }

  return NextResponse.json(data);
}