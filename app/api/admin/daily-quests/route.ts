import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/** Verify the caller is an authenticated admin. Returns null on success or an error response. */
async function requireAdmin() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles").select("is_admin").eq("id", user.id).single();
  if (!profile?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return null;
}

const CATEGORIES = ["savings", "behavioral", "streak", "challenge"];

function validate(body: any) {
  if (!body.id || typeof body.id !== "string" || !/^[a-z0-9_]+$/.test(body.id)) {
    return "id is required and must be lowercase letters, numbers, and underscores only";
  }
  if (!body.title || typeof body.title !== "string") return "title is required";
  if (!body.description || typeof body.description !== "string") return "description is required";
  if (body.category && !CATEGORIES.includes(body.category)) return `category must be one of: ${CATEGORIES.join(", ")}`;
  if (body.xp_reward != null && (typeof body.xp_reward !== "number" || body.xp_reward < 0)) return "xp_reward must be a non-negative number";
  if (body.day_of_week != null && (body.day_of_week < 0 || body.day_of_week > 6)) return "day_of_week must be between 0 and 6";
  return null;
}

// ── READ (list) ─────────────────────────────────────────────
export async function GET() {
  const authErr = await requireAdmin();
  if (authErr) return authErr;

  const service = createServiceClient();
  const { data, error } = await service.from("daily_quests").select("*").order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ quests: data });
}

// ── CREATE ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const authErr = await requireAdmin();
  if (authErr) return authErr;

  const body = await req.json();
  const validationError = validate(body);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  const service = createServiceClient();
  const { data, error } = await service
    .from("daily_quests")
    .insert({
      id:          body.id,
      title:       body.title,
      description: body.description,
      category:    body.category ?? "behavioral",
      xp_reward:   body.xp_reward ?? 50,
      icon:        body.icon ?? "⭐",
      day_of_week: body.day_of_week ?? null,
      is_active:   body.is_active ?? true,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: `A daily quest with id "${body.id}" already exists` }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ quest: data });
}

// ── UPDATE ────────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const authErr = await requireAdmin();
  if (authErr) return authErr;

  const body = await req.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: "Missing quest id" }, { status: 400 });

  if (updates.category && !CATEGORIES.includes(updates.category)) {
    return NextResponse.json({ error: `category must be one of: ${CATEGORIES.join(", ")}` }, { status: 400 });
  }
  if (updates.xp_reward != null && (typeof updates.xp_reward !== "number" || updates.xp_reward < 0)) {
    return NextResponse.json({ error: "xp_reward must be a non-negative number" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from("daily_quests")
    .update({
      title:       updates.title,
      description: updates.description,
      category:    updates.category,
      xp_reward:   updates.xp_reward,
      icon:        updates.icon,
      day_of_week: updates.day_of_week,
      is_active:   updates.is_active,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ quest: data });
}

// ── DELETE ────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const authErr = await requireAdmin();
  if (authErr) return authErr;

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing quest id" }, { status: 400 });

  const service = createServiceClient();

  // Guard: refuse hard delete if any user progress references this quest.
  const { count } = await service
    .from("daily_quest_logs")
    .select("id", { count: "exact", head: true })
    .eq("quest_id", id);

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: `Cannot delete — ${count} user(s) have completion logs for this quest. Disable it instead.` },
      { status: 409 }
    );
  }

  // Guard: refuse if referenced as a step requirement in any quest chain.
  const { count: stepCount } = await service
    .from("quest_chain_steps")
    .select("id", { count: "exact", head: true })
    .eq("requires_quest_id", id);

  if ((stepCount ?? 0) > 0) {
    return NextResponse.json(
      { error: `Cannot delete — this quest is required by ${stepCount} quest chain step(s). Disable it instead.` },
      { status: 409 }
    );
  }

  const { error } = await service.from("daily_quests").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
