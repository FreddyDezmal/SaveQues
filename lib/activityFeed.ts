/**
 * lib/activityFeed.ts
 *
 * Sprint 22, Phase 8.
 *
 * Every other activity_feed event type (goal_completed, achievement_
 * unlocked, streak_milestone, group_joined, group_quest_completed) is
 * posted by a database trigger reacting to a real state change
 * (051_activity_feed_writes.sql) — no application code needed.
 *
 * level_up is the one exception. profiles.current_level is never written
 * anywhere in this schema (checked — see 051's file header); level is
 * computed purely on the fly by getLevelFromXP() in lib/awardXP.ts, and
 * level-up detection already happens in application code via
 * detectLevelUp() at the two places that award XP for user actions. This
 * file just posts to the feed from those same two spots, using the
 * service-role client because public.service_post_level_up() is
 * REVOKEd from `authenticated` (same reasoning as service_complete_
 * group_quest in 050) — it's not reachable any other way.
 *
 * Fire-and-forget by convention: call sites should .catch() this and log,
 * never await it as something that can fail the response — same pattern
 * already used for sendMilestoneCelebration() in lib/awardXP.ts. A failed
 * feed post should never turn a successful deposit or quest completion
 * into an error response.
 */

import { createServiceClient } from "./supabase/server";

export async function postLevelUpToFeed(
  userId: string,
  newLevel: number,
  newTitle: string
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.rpc("service_post_level_up", {
    p_user_id: userId,
    p_new_level: newLevel,
    p_new_title: newTitle,
  });

  if (error) {
    console.error("[activityFeed] Failed to post level_up:", error);
  }
}