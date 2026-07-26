/**
 * app/api/group-quests/check-completion/route.ts
 *
 * Checks whether a group quest's condition is met and, if so, settles it
 * — marks it completed, increments the group's XP, and awards xp_reward
 * to every currently-active member. Safe to call liberally: idempotent,
 * and a no-op if the quest isn't active or the condition isn't met yet.
 *
 * Two-step authorization, deliberately not combined into one call:
 *   1. Fetch the quest with the normal (RLS-respecting) user-session
 *      client. group_quests' SELECT policy already restricts this to
 *      active members of the quest's group (045) — so a row coming back
 *      at all IS the membership proof. No row → 404, whether that's
 *      because the quest doesn't exist or the caller isn't a member;
 *      those aren't distinguished, same as elsewhere in this sprint.
 *   2. Only then call public.service_complete_group_quest() using the
 *      SERVICE-ROLE client (lib/supabase/server.ts createServiceClient),
 *      since that function is REVOKEd from `authenticated` entirely
 *      (050) — it is unreachable any other way, by design. See 050's
 *      file header for why this needs a service-role trust boundary
 *      instead of the normal award_xp() path.
 */

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkAttemptRateLimit, recordAttempt } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";
import { sendGroupQuestCompleted } from "@/lib/notifications";

const log = createLogger("groupQuests.checkCompletion");
const RATE_LIMIT_ENDPOINT = "groupQuests.checkCompletion";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { groupQuestId } = await req.json().catch(() => ({}));
  if (!groupQuestId) {
    return NextResponse.json({ error: "groupQuestId required" }, { status: 400 });
  }

  const limit = await checkAttemptRateLimit(supabase, {
    userId: user.id,
    endpoint: RATE_LIMIT_ENDPOINT,
    windowMinutes: 10,
    maxRequests: 20,
    actionLabel: "completion checks",
  });
  await recordAttempt(supabase, user.id, RATE_LIMIT_ENDPOINT);
  if (!limit.allowed) {
    return NextResponse.json({ error: limit.message }, { status: 429 });
  }

  // Membership proof: RLS on group_quests only returns this row to an
  // active member of its group.
  const { data: questRow, error: fetchError } = await supabase
    .from("group_quests")
    .select("id")
    .eq("id", groupQuestId)
    .maybeSingle();

  if (fetchError) {
    log.error("quest lookup failed", { user_id: user.id, group_quest_id: groupQuestId, error: fetchError.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
  if (!questRow) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const serviceClient = createServiceClient();
  const { data, error } = await serviceClient.rpc("service_complete_group_quest", { p_group_quest_id: groupQuestId });

  if (error) {
    log.error("service_complete_group_quest failed", { user_id: user.id, group_quest_id: groupQuestId, error: error.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  if (data?.completed && Array.isArray(data.members_awarded) && data.members_awarded.length > 0) {
    // Service client — the caller may not retain read access to this
    // quest's group by the time this runs (e.g. they left right after
    // triggering completion), and this must not fail the
    // already-successful completion response either way.
    const { data: quest } = await serviceClient
      .from("group_quests")
      .select("group_id, title, groups(name)")
      .eq("id", groupQuestId)
      .single();
    const groupName = (quest as any)?.groups?.name || "Your group";
    const questTitle = quest?.title || "a group quest";

    for (const memberId of data.members_awarded as string[]) {
      sendGroupQuestCompleted(memberId, quest?.group_id, groupName, questTitle).catch((err) =>
        log.error("sendGroupQuestCompleted failed", { member_id: memberId, error: err.message })
      );
    }
  }

  return NextResponse.json(data);
}