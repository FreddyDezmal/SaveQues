/**
 * app/api/onboarding/complete/route.ts
 *
 * Called by the client once all three checklist items are done.
 * Stamps onboarding_completed_at on the profile (idempotent).
 *
 * Emits: ONBOARDING_COMPLETED
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { trackServerEvent } from "@/lib/analytics-server";
import { AnalyticsEvents } from "@/lib/analytics";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    minutes_since_signup?: number;
    goals_created?: number;
    first_deposit_completed?: boolean;
    first_quest_completed?: boolean;
  } = {};

  try { body = await req.json(); } catch { /* optional body */ }

  // Idempotency: only stamp if not already set
  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed_at, created_at")
    .eq("id", user.id)
    .single();

  if (profile?.onboarding_completed_at) {
    return NextResponse.json({ skipped: true });
  }

  await supabase
    .from("profiles")
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq("id", user.id);

  // Compute minutes_since_signup from profile if not supplied
  const minutesSinceSignup =
    body.minutes_since_signup ??
    (profile?.created_at
      ? Math.round((Date.now() - new Date(profile.created_at).getTime()) / 60000)
      : null);

  await trackServerEvent(AnalyticsEvents.ONBOARDING_COMPLETED, user.id, {
    minutes_since_signup:    minutesSinceSignup,
    goals_created:           body.goals_created ?? null,
    first_deposit_completed: body.first_deposit_completed ?? false,
    first_quest_completed:   body.first_quest_completed ?? false,
  });

  return NextResponse.json({ completed: true });
}