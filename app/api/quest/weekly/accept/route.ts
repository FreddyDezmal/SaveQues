/**
 * app/api/quest/weekly/accept/route.ts
 *
 * Accepts (registers intent to complete) this week's quest.
 * No XP is awarded at accept time. This route exists so the
 * client has zero Supabase writes on the quests page.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { questId, weekStart } = await req.json();
  if (!questId || !weekStart) {
    return NextResponse.json({ error: "questId and weekStart required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("user_weekly_quests")
    .upsert({
      user_id:     user.id,
      quest_id:    questId,
      week_start:  weekStart,
      status:      "active",
      accepted_at: new Date().toISOString(),
    }, { onConflict: "user_id,week_start" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
