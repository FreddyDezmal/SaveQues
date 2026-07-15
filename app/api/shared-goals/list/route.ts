/**
 * app/api/shared-goals/list/route.ts
 *
 * "My shared goals" in one round trip via public.list_my_shared_goals()
 * (049): goals I own and share, goals I contribute to, pending invites.
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("sharedGoals.list");

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase.rpc("list_my_shared_goals");

  if (error) {
    log.error("list_my_shared_goals RPC failed", { user_id: user.id, error: error.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  return NextResponse.json(data ?? { owned: [], contributing: [], pending_invites: [] });
}