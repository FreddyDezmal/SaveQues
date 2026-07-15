/**
 * app/api/group-quests/progress/route.ts
 *
 * Live progress preview via public.compute_group_quest_progress() (050)
 * — aggregate counts only, no per-member dollar breakdown (see that
 * migration's PART C.1 comment for why). This never completes the
 * quest — it's a pure read, even if is_condition_met comes back true.
 * Call /api/group-quests/check-completion to actually settle it.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("groupQuests.progress");

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const groupQuestId = req.nextUrl.searchParams.get("groupQuestId");
  if (!groupQuestId) {
    return NextResponse.json({ error: "groupQuestId required" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("compute_group_quest_progress", { p_group_quest_id: groupQuestId });

  if (error) {
    log.error("compute_group_quest_progress RPC failed", { user_id: user.id, group_quest_id: groupQuestId, error: error.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}