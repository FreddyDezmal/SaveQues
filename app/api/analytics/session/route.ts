/**
 * app/api/analytics/session/route.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Lightweight session ping endpoint.
 *
 * Called once per page load from the dashboard to:
 *  1. Record `app_opened = true` in `analytics_daily_activity`
 *  2. Refresh the user's `user_engagement_status` (clears at_risk / churned
 *     back to active as soon as the user returns)
 *
 * This is the primary signal for DAU, WAU, MAU, and D1/D7/D30 retention.
 *
 * METHOD: POST (no body required)
 * Auth:   Required (reads session via createClient)
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { recordDailyActivity } from "@/lib/recordDailyActivity";

export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Record that the app was opened today (idempotent — safe to call multiple times)
  await recordDailyActivity(supabase, user.id, { app_opened: true });

  // Refresh engagement status so returning users move back to "active"
  // Uses service role to bypass RLS on user_engagement_status
  try {
    const today = new Date().toISOString().split("T")[0];
    await supabase.rpc("update_engagement_status", { p_user_id: user.id });
  } catch {
    // Non-critical — silently ignore
  }

  return NextResponse.json({ ok: true });
}