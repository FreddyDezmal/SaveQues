/**
 * app/api/events/complete/route.ts
 *
 * Security guarantees:
 *  • Status guard    — complete_event() DB function only marks complete
 *                      when participation status = 'active'
 *  • Idempotency     — award_xp() source_id = event_slug
 *  • XP amount       — read from DB/static config server-side, never from client
 *  • Event window    — verified server-side before awarding
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { getEventWindow, STATIC_EVENTS } from "@/lib/events";
import { trackServerEvent, AnalyticsEvents } from "@/lib/analytics-server";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { eventSlug } = await req.json();
  if (!eventSlug) return NextResponse.json({ error: "eventSlug required" }, { status: 400 });

  // ── 1. Resolve XP reward server-side ─────────────────────────
  // First check static events (code-defined), then DB events.
  const staticEvent = STATIC_EVENTS.find(e => e.id === eventSlug);
  let xpReward: number;

  if (staticEvent) {
    // Verify the event is currently active (not expired or future)
    const window = getEventWindow(staticEvent);
    if (!window.canJoin && window.status !== "active") {
      return NextResponse.json({ error: "Event is not currently active" }, { status: 409 });
    }
    xpReward = staticEvent.xp_reward;
  } else {
    // Look up in DB events table
    const { data: dbEvent } = await supabase
      .from("events")
      .select("xp_reward, available_from, available_until, is_annual, preview_days, is_active")
      .eq("slug", eventSlug)
      .single();

    if (!dbEvent || !dbEvent.is_active) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const window = getEventWindow({
      available_from:  dbEvent.available_from,
      available_until: dbEvent.available_until,
      is_annual:       dbEvent.is_annual,
      preview_days:    dbEvent.preview_days,
    });

    if (window.status === "expired") {
      return NextResponse.json({ error: "Event has expired" }, { status: 409 });
    }

    xpReward = dbEvent.xp_reward;
  }

  // ── 2. Atomic DB function — marks participation + awards XP ──
  const { data: result, error } = await supabase.rpc("complete_event", {
    p_user_id:    user.id,
    p_event_slug: eventSlug,
    p_xp:         xpReward,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rpcResult = result as { success: boolean; xp_awarded: number; new_total: number; reason?: string };

  if (rpcResult.reason === "already_awarded") {
    return NextResponse.json({ xpGained: 0, alreadyAwarded: true });
  }

  // ── Analytics ─────────────────────────────────────────────────
  await trackServerEvent(AnalyticsEvents.EVENT_COMPLETED, user.id, {
    event_slug: eventSlug,
    xp_gained:  rpcResult.xp_awarded,
  });

  await trackServerEvent(AnalyticsEvents.XP_AWARDED, user.id, {
    amount:      rpcResult.xp_awarded,
    source_type: "event_complete",
  });

  return NextResponse.json({
    xpGained:      rpcResult.xp_awarded,
    newTotal:      rpcResult.new_total,
    alreadyAwarded: false,
  });
}
