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

// ── CREATE ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const authErr = await requireAdmin();
  if (authErr) return authErr;

  const body = await req.json();
  const service = createServiceClient();

  const { data, error } = await service
    .from("events")
    .insert({
      slug:            body.slug,
      title:           body.title,
      description:     body.description,
      emoji:           body.emoji ?? "⚡",
      event_type:      body.event_type ?? "savequest",
      xp_reward:       body.xp_reward ?? 200,
      available_from:  body.available_from || null,
      available_until: body.available_until || null,
      is_annual:       body.is_annual ?? false,
      preview_days:    body.preview_days ?? 5,
      is_active:       body.is_active ?? true,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ event: data });
}

// ── UPDATE ────────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const authErr = await requireAdmin();
  if (authErr) return authErr;

  const body = await req.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: "Missing event id" }, { status: 400 });

  const service = createServiceClient();

  const { data, error } = await service
    .from("events")
    .update({
      title:           updates.title,
      description:     updates.description,
      emoji:           updates.emoji,
      event_type:      updates.event_type,
      xp_reward:       updates.xp_reward,
      available_from:  updates.available_from || null,
      available_until: updates.available_until || null,
      is_annual:       updates.is_annual,
      preview_days:    updates.preview_days,
      is_active:       updates.is_active,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ event: data });
}

// ── DELETE ────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const authErr = await requireAdmin();
  if (authErr) return authErr;

  const { id, slug } = await req.json();
  if (!id || !slug) return NextResponse.json({ error: "Missing id or slug" }, { status: 400 });

  const service = createServiceClient();

  // Guard: check for participants
  const { count } = await service
    .from("user_event_participation")
    .select("id", { count: "exact", head: true })
    .eq("event_slug", slug);

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: `Cannot delete — this event has ${count} participant(s). Edit or deactivate it instead.` },
      { status: 409 }
    );
  }

  const { error } = await service.from("events").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
