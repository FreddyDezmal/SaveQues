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
import { createLogger } from "@/lib/logger";
import { captureError, setSentryUser } from "@/lib/monitoring";

const log = createLogger("onboarding.complete");

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    log.warn("Unauthenticated request", { action: "auth_check" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  setSentryUser(user.id);

  let body: {
    minutes_since_signup?: number;
    goals_created?: number;
    first_deposit_completed?: boolean;
    first_quest_completed?: boolean;
  } = {};

  try { body = await req.json(); } catch { /* optional body */ }

  const end = log.time("onboarding completion", { user_id: user.id });

  try {
    // Idempotency: only stamp if not already set
    const { data: profile } = await supabase
      .from("profiles")
      .select("onboarding_completed_at, created_at")
      .eq("id", user.id)
      .single();

    if (profile?.onboarding_completed_at) {
      log.info("Onboarding already completed — skipping", { user_id: user.id });
      return NextResponse.json({ skipped: true });
    }

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ onboarding_completed_at: new Date().toISOString() })
      .eq("id", user.id);

    if (updateError) {
      log.error("Failed to stamp onboarding_completed_at", {
        user_id:    user.id,
        error:      updateError.message,
        error_code: updateError.code,
      });
      captureError(updateError, {
        route:   "POST /api/onboarding/complete",
        user_id: user.id,
      });
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

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

    end({
      user_id:              user.id,
      minutes_since_signup: minutesSinceSignup ?? undefined,
      goals_created:        body.goals_created ?? 0,
    });

    return NextResponse.json({ completed: true });

  } catch (err: any) {
    log.error("Unexpected error completing onboarding", {
      user_id: user.id,
      error:   err.message ?? String(err),
    });
    captureError(err, {
      route:   "POST /api/onboarding/complete",
      user_id: user.id,
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}