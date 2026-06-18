/**
 * app/api/onboarding/starter-goal/route.ts
 *
 * Called immediately after successful account creation in the signup flow.
 * Auto-creates a starter savings goal based on the user's stated saving intent.
 *
 * Security:
 *  • Auth required — only creates a goal for the authenticated user.
 *  • Idempotent — checks onboarding_goal_created flag; won't create twice.
 *  • Failure is non-fatal — account creation already succeeded; we log and 200.
 *
 * Emits: GOAL_CREATED with source="onboarding"
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { trackServerEvent } from "@/lib/analytics-server";
import { AnalyticsEvents } from "@/lib/analytics";
import { createLogger } from "@/lib/logger";
import { captureError, setSentryUser } from "@/lib/monitoring";

const log = createLogger("onboarding.starter-goal");

// ── Starter goal mappings ─────────────────────────────────────────────────────

interface StarterGoal {
  title: string;
  category: string;
  goal_emoji: string;
  target_amount: number;
}

const STARTER_GOALS: Record<string, StarterGoal> = {
  travel: {
    title:         "My Travel Fund",
    category:      "travel",
    goal_emoji:    "✈️",
    target_amount: 5000,
  },
  emergency: {
    title:         "Emergency Fund",
    category:      "emergency",
    goal_emoji:    "🛡️",
    target_amount: 10000,
  },
  gadget: {
    title:         "New Gadget",
    category:      "gadget",
    goal_emoji:    "💻",
    target_amount: 3000,
  },
  tuition: {
    title:         "Education Fund",
    category:      "tuition",
    goal_emoji:    "🎓",
    target_amount: 8000,
  },
  custom: {
    title:         "My Savings Goal",
    category:      "custom",
    goal_emoji:    "⭐",
    target_amount: 5000,
  },
};

const DEFAULT_STARTER: StarterGoal = STARTER_GOALS.custom;

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    log.warn("Unauthenticated request", { action: "auth_check" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  setSentryUser(user.id);

  let savingFor = "custom";
  try {
    const body = await req.json();
    savingFor = body.saving_for ?? "custom";
  } catch {
    log.debug("No body or parse failure — using default category", { user_id: user.id });
  }

  const end = log.time("starter goal creation", { user_id: user.id, saving_for: savingFor });

  try {
    // ── Idempotency check ─────────────────────────────────────────
    const { data: profile } = await supabase
      .from("profiles")
      .select("onboarding_goal_created")
      .eq("id", user.id)
      .single();

    if (profile?.onboarding_goal_created) {
      log.info("Starter goal already exists — skipping", { user_id: user.id });
      return NextResponse.json({ skipped: true });
    }

    // ── Resolve starter goal template ─────────────────────────────
    const template = STARTER_GOALS[savingFor] ?? DEFAULT_STARTER;

    // ── Insert the goal ───────────────────────────────────────────
    const { data: goal, error: goalError } = await supabase
      .from("savings_goals")
      .insert({
        user_id:        user.id,
        title:          template.title,
        category:       template.category,
        goal_emoji:     template.goal_emoji,
        target_amount:  template.target_amount,
        current_amount: 0,
        target_date:    null,
        is_complete:    false,
      })
      .select("id")
      .single();

    if (goalError) {
      log.error("Goal insert failed", {
        user_id:      user.id,
        saving_for:   savingFor,
        error:        goalError.message,
        error_code:   goalError.code,
      });
      captureError(goalError, {
        route:      "POST /api/onboarding/starter-goal",
        user_id:    user.id,
        saving_for: savingFor,
      });
      return NextResponse.json({ error: goalError.message }, { status: 500 });
    }

    // ── Mark profile ──────────────────────────────────────────────
    await supabase
      .from("profiles")
      .update({ onboarding_goal_created: true })
      .eq("id", user.id);

    // ── Analytics ─────────────────────────────────────────────────
    await trackServerEvent(AnalyticsEvents.GOAL_CREATED, user.id, {
      goal_category:  template.category,
      target_amount:  template.target_amount,
      source:         "onboarding",
    });

    end({
      user_id:       user.id,
      goal_id:       goal.id,
      goal_category: template.category,
      target_amount: template.target_amount,
    });

    return NextResponse.json({ created: true, goal_id: goal.id });

  } catch (err: any) {
    log.error("Unexpected error during starter goal creation", {
      user_id: user.id,
      error:   err.message ?? String(err),
    });
    captureError(err, {
      route:   "POST /api/onboarding/starter-goal",
      user_id: user.id,
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}