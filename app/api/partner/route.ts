/**
 * app/api/partner/route.ts
 *
 * Returns the caller's accountability partner state in one round trip via
 * public.get_partner_status() (047): 'none' | 'pending_sent' |
 * 'pending_received' | 'active', with the other person's safe profile
 * fields and (only when active) a saved_this_week boolean — never an
 * amount, balance, or which goal.
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("partner.status");

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase.rpc("get_partner_status");

  if (error) {
    log.error("get_partner_status RPC failed", { user_id: user.id, error: error.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  return NextResponse.json(data ?? { state: "none" });
}