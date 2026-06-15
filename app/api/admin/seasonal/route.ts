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

const QUEST_TYPES = ["evergreen", "seasonal", "annual_event", "campaign"];

function validate(body: any) {
  if (!body.title || typeof body.title !== "string") return "title is required";
  if (!body.description || typeof body.description !== "string") return "description is required";
  if (body.quest_type && !QUEST_TYPES.includes(body.quest_type)) return `quest_type must be one of: ${QUEST_TYPES.join(", ")}`;
  if (body.xp_reward != null && (typeof body.xp_reward !== "number" || body.xp_reward < 0)) return "xp_reward must be a non-negative number";
  if (body.duration_days != null && (typeof body.duration_days !== "number" || body.duration_days <= 0)) return "duration_days must be a positive number";
  return null;
}

// ── READ (list) ─────────────────────────────────────────────
export async function GET() {
  const authErr = await requireAdmin();
  if (authErr) return authErr;

  const service = createServiceClient();
  const { data, error } = await service.from("challenges").select("*").order("start_date", { ascending: false, nullsFirst: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ challenges: data });
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
    .from("challenges")
    .insert({
      title:         body.title,
      description:   body.description,
      type:          body.type ?? "manual",
      xp_reward:     body.xp_reward ?? 200,
      duration_days: body.duration_days ?? 7,
      is_active:     body.is_active ?? true,
      quest_type:    body.quest_type ?? "evergreen",
      start_date:    body.start_date || null,
      end_date:      body.end_date || null,
      preview_days:  body.preview_days ?? 3,
      year_agnostic: body.year_agnostic ?? false,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ challenge: data });
}

// ── UPDATE ────────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const authErr = await requireAdmin();
  if (authErr) return authErr;

  const body = await req.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: "Missing challenge id" }, { status: 400 });

  if (updates.quest_type && !QUEST_TYPES.includes(updates.quest_type)) {
    return NextResponse.json({ error: `quest_type must be one of: ${QUEST_TYPES.join(", ")}` }, { status: 400 });
  }
  if (updates.xp_reward != null && (typeof updates.xp_reward !== "number" || updates.xp_reward < 0)) {
    return NextResponse.json({ error: "xp_reward must be a non-negative number" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from("challenges")
    .update({
      title:         updates.title,
      description:   updates.description,
      type:          updates.type,
      xp_reward:     updates.xp_reward,
      duration_days: updates.duration_days,
      is_active:     updates.is_active,
      quest_type:    updates.quest_type,
      start_date:    updates.start_date || null,
      end_date:      updates.end_date || null,
      preview_days:  updates.preview_days,
      year_agnostic: updates.year_agnostic,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ challenge: data });
}

// ── DELETE ────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const authErr = await requireAdmin();
  if (authErr) return authErr;

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing challenge id" }, { status: 400 });

  const service = createServiceClient();

  // Guard: refuse hard delete if any user has joined/completed this challenge.
  const { count } = await service
    .from("user_challenges")
    .select("id", { count: "exact", head: true })
    .eq("challenge_id", id);

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: `Cannot delete — ${count} user(s) have progress on this challenge. Disable it instead.` },
      { status: 409 }
    );
  }

  const { error } = await service.from("challenges").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
