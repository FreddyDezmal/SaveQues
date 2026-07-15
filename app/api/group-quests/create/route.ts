/**
 * app/api/group-quests/create/route.ts
 *
 * Owner/admin creates a group quest. RLS (group_quests_insert_owner_or_
 * admin, 045) already restricts this; the checks here just produce a
 * clean error instead of a raw RLS failure, and validate the shape the
 * quest_type CHECK constraint and group_quest_raw_progress (050) expect.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkAttemptRateLimit, recordAttempt } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";

const log = createLogger("groupQuests.create");
const RATE_LIMIT_ENDPOINT = "groupQuests.create";
const QUEST_TYPES = ["everyone_saves_this_week", "deposit_count_together", "target_amount_together", "full_participation"];
const NEEDS_TARGET = ["deposit_count_together", "target_amount_together"];

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { groupId, questType, startDate, endDate } = body;
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 80) : "";
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 300) : null;
  const xpReward = Number.isInteger(body.xpReward) && body.xpReward > 0 && body.xpReward <= 2000 ? body.xpReward : 200;
  const targetValue = typeof body.targetValue === "number" && body.targetValue > 0 ? body.targetValue : null;

  if (!groupId || !QUEST_TYPES.includes(questType) || !title || !startDate || !endDate) {
    return NextResponse.json(
      { error: `groupId, questType (one of ${QUEST_TYPES.join(", ")}), title, startDate, endDate required` },
      { status: 400 }
    );
  }
  if (NEEDS_TARGET.includes(questType) && !targetValue) {
    return NextResponse.json({ error: `${questType} requires a positive targetValue` }, { status: 400 });
  }
  if (new Date(endDate) < new Date(startDate)) {
    return NextResponse.json({ error: "endDate must be on or after startDate" }, { status: 400 });
  }

  const limit = await checkAttemptRateLimit(supabase, {
    userId: user.id,
    endpoint: RATE_LIMIT_ENDPOINT,
    windowMinutes: 60,
    maxRequests: 15,
    actionLabel: "group quests created",
  });
  await recordAttempt(supabase, user.id, RATE_LIMIT_ENDPOINT);
  if (!limit.allowed) {
    return NextResponse.json({ error: limit.message }, { status: 429 });
  }

  const { data, error } = await supabase
    .from("group_quests")
    .insert({
      group_id: groupId,
      quest_type: questType,
      title,
      description,
      target_value: NEEDS_TARGET.includes(questType) ? targetValue : null,
      xp_reward: xpReward,
      start_date: startDate,
      end_date: endDate,
      created_by: user.id,
    })
    .select("id, quest_type, title, description, target_value, xp_reward, start_date, end_date, status")
    .single();

  if (error) {
    log.warn("group quest create failed", { user_id: user.id, group_id: groupId, error: error.message });
    return NextResponse.json({ error: "Couldn't create that quest — check you're the owner or an admin" }, { status: 400 });
  }

  return NextResponse.json({ success: true, quest: data });
}