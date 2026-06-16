/**
 * app/api/events/join/route.ts
 *
 * Registers a user's intent to participate in an event.
 * No XP is awarded at join time — that happens via /api/events/complete.
 *
 * This route was introduced in Sprint 3 to replace the direct
 * browser-SDK insert that EventCard.tsx previously made into
 * user_event_participation. Now that the INSERT RLS policy on that
 * table is tightened (status must be 'active', xp_earned/completed_at
 * must be NULL), a server route is the cleanest owner of this write.
 *
 * Security guarantees:
 *  • Auth required        — unauthenticated requests rejected with 401
 *  • Event existence      — event must exist and be currently joinable
 *  • No self-completion   — inserts status='active' only; completion is
 *                           handled exclusively by complete_event() RPC
 *  • Idempotent           — UNIQUE (user_id, event_slug) constraint means
 *                           a second join call returns success silently
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { getEventWindow, STATIC_EVENTS } from "@/lib/events";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { eventSlug } = await req.json();
  if (!eventSlug) return NextResponse.json({ error: "eventSlug required" }, { status: 400 });

  // Verify the event exists and is currently open for joining
  const staticEvent = STATIC_EVENTS.find(e => e.id === eventSlug);

  if (staticEvent) {
    const window = getEventWindow(staticEvent);
    if (!window.canJoin) {
      return NextResponse.json({ error: "Event is not currently open for joining" }, { status: 409 });
    }
  } else {
    const { data: dbEvent } = await supabase
      .from("events")
      .select("available_from, available_until, is_annual, preview_days, is_active")
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
    } as any);

    if (!window.canJoin) {
      return NextResponse.json({ error: "Event is not currently open for joining" }, { status: 409 });
    }
  }

  const { error } = await supabase
    .from("user_event_participation")
    .insert({
      user_id:    user.id,
      event_slug: eventSlug,
      status:     "active",
      joined_at:  new Date().toISOString(),
    });

  // Duplicate join — idempotent success
  if (error && (error.code === "23505" || error.message.includes("duplicate"))) {
    return NextResponse.json({ success: true, alreadyJoined: true });
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, alreadyJoined: false });
}