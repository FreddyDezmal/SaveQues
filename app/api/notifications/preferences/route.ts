import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const CATEGORIES = [
  "achievements",
  "goal_reminders",
  "streak_reminders",
  "weekly_summaries",
  "milestone_celebrations",
  "product_announcements",
] as const;

type Category = (typeof CATEGORIES)[number];

/**
 * GET: returns the current user's notification preferences, creating a
 * default row (all categories true — "sensible defaults" per the sprint
 * brief) on first access rather than requiring a separate signup-time
 * insert step elsewhere in the codebase.
 */
export async function GET() {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: existing, error: selectErr } = await supabase
      .from("notification_preferences")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (selectErr) {
      return NextResponse.json({ error: selectErr.message }, { status: 500 });
    }

    if (existing) {
      return NextResponse.json({ preferences: existing });
    }

    // No row yet — insert defaults. Upsert with ignoreDuplicates would also
    // work; plain insert is fine here since RLS + the maybeSingle() check
    // above already make a race extremely unlikely to matter (worst case:
    // a duplicate-key error on a near-simultaneous double click, which the
    // client just retries).
    const { data: created, error: insertErr } = await supabase
      .from("notification_preferences")
      .insert({ user_id: user.id })
      .select("*")
      .single();

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({ preferences: created });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * PATCH: updates one or more category booleans. Whitelists both the field
 * names and value types explicitly rather than passing the request body
 * through to Supabase — this is a settings row, but the same discipline
 * used on financial routes elsewhere in this codebase (never trust a
 * client-shaped object directly into an .update() call) applies here too.
 */
export async function PATCH(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const updates: Partial<Record<Category, boolean>> = {};

    for (const key of CATEGORIES) {
      if (key in body) {
        if (typeof body[key] !== "boolean") {
          return NextResponse.json({ error: `${key} must be a boolean` }, { status: 400 });
        }
        updates[key] = body[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid preference fields provided" }, { status: 400 });
    }

    // Upsert so a PATCH still succeeds even if the GET-creates-defaults
    // path above was somehow never hit for this user (e.g. an existing
    // user who never opened the preferences page before this sprint
    // shipped, and lands directly on a PATCH via some future entry point).
    const { data, error } = await supabase
      .from("notification_preferences")
      .upsert({ user_id: user.id, ...updates }, { onConflict: "user_id" })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ preferences: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
