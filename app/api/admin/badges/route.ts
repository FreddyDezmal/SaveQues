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

const CATEGORIES  = ["streak", "savings", "quest", "social", "special", "hidden"];
const VISIBILITY  = ["visible", "hidden"];

function validate(body: any) {
  if (!body.id || typeof body.id !== "string" || !/^[a-z0-9_]+$/.test(body.id)) {
    return "id is required and must be lowercase letters, numbers, and underscores only";
  }
  if (!body.title || typeof body.title !== "string") return "title is required";
  if (!body.description || typeof body.description !== "string") return "description is required";
  if (body.category && !CATEGORIES.includes(body.category)) return `category must be one of: ${CATEGORIES.join(", ")}`;
  if (body.visibility && !VISIBILITY.includes(body.visibility)) return `visibility must be one of: ${VISIBILITY.join(", ")}`;
  if (body.xp_reward != null && (typeof body.xp_reward !== "number" || body.xp_reward < 0)) return "xp_reward must be a non-negative number";
  return null;
}

// ── READ (list) ─────────────────────────────────────────────
export async function GET() {
  const authErr = await requireAdmin();
  if (authErr) return authErr;

  const service = createServiceClient();
  const { data, error } = await service.from("badges").select("*").order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ badges: data });
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
    .from("badges")
    .insert({
      id:              body.id,
      title:           body.title,
      description:     body.description,
      unlock_criteria: body.unlock_criteria || body.description,
      category:        body.category ?? "special",
      icon:            body.icon ?? "🏅",
      xp_reward:       body.xp_reward ?? 0,
      secret:          body.secret ?? false,
      visibility:      body.visibility ?? "visible",
      is_active:       body.is_active ?? true,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: `A badge with id "${body.id}" already exists` }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ badge: data });
}

// ── UPDATE ────────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const authErr = await requireAdmin();
  if (authErr) return authErr;

  const body = await req.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: "Missing badge id" }, { status: 400 });

  if (updates.category && !CATEGORIES.includes(updates.category)) {
    return NextResponse.json({ error: `category must be one of: ${CATEGORIES.join(", ")}` }, { status: 400 });
  }
  if (updates.visibility && !VISIBILITY.includes(updates.visibility)) {
    return NextResponse.json({ error: `visibility must be one of: ${VISIBILITY.join(", ")}` }, { status: 400 });
  }
  if (updates.xp_reward != null && (typeof updates.xp_reward !== "number" || updates.xp_reward < 0)) {
    return NextResponse.json({ error: "xp_reward must be a non-negative number" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from("badges")
    .update({
      title:           updates.title,
      description:     updates.description,
      unlock_criteria: updates.unlock_criteria,
      category:        updates.category,
      icon:            updates.icon,
      xp_reward:       updates.xp_reward,
      secret:          updates.secret,
      visibility:      updates.visibility,
      is_active:       updates.is_active,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ badge: data });
}

// ── DELETE ────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const authErr = await requireAdmin();
  if (authErr) return authErr;

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing badge id" }, { status: 400 });

  const service = createServiceClient();

  // Guard: refuse hard delete if any user has already earned this badge.
  const { count } = await service
    .from("user_achievements")
    .select("id", { count: "exact", head: true })
    .eq("achievement_id", id);

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: `Cannot delete — ${count} user(s) have earned this badge. Disable it instead.` },
      { status: 409 }
    );
  }

  // Guard: refuse if referenced as a quest chain completion badge.
  const { count: chainCount } = await service
    .from("quest_chains")
    .select("id", { count: "exact", head: true })
    .eq("completion_badge_id", id);

  if ((chainCount ?? 0) > 0) {
    return NextResponse.json(
      { error: `Cannot delete — this badge is the completion reward for ${chainCount} quest chain(s). Update those chains first.` },
      { status: 409 }
    );
  }

  const { error } = await service.from("badges").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
