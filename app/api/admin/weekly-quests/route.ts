/**
 * app/api/admin/weekly-quests/route.ts — Sprint 4 (M4: audit logging added)
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, auditLog }    from "@/lib/adminAudit";

const CATEGORIES = ["savings", "behavioral", "streak", "challenge"];

function validate(body: any) {
  if (!body.id || typeof body.id !== "string" || !/^[a-z0-9_]+$/.test(body.id))
    return "id is required and must be lowercase letters, numbers, and underscores only";
  if (!body.title || typeof body.title !== "string") return "title is required";
  if (!body.description || typeof body.description !== "string") return "description is required";
  if (body.category && !CATEGORIES.includes(body.category))
    return `category must be one of: ${CATEGORIES.join(", ")}`;
  if (body.xp_reward != null && (typeof body.xp_reward !== "number" || body.xp_reward < 0))
    return "xp_reward must be a non-negative number";
  return null;
}

export async function GET() {
  try {
    const { service } = await requireAdmin();
    const { data, error } = await service.from("weekly_quests").select("*").order("created_at");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ quests: data });
  } catch (res) { return res as Response; }
}

export async function POST(req: NextRequest) {
  try {
    const { user, service } = await requireAdmin();
    const body = await req.json();
    const validationError = validate(body);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    const { data, error } = await service.from("weekly_quests").insert({
      id: body.id, title: body.title, description: body.description,
      category: body.category ?? "behavioral", xp_reward: body.xp_reward ?? 300,
      icon: body.icon ?? "⭐", is_active: body.is_active ?? true,
    }).select().single();

    if (error) {
      if (error.code === "23505")
        return NextResponse.json({ error: `A weekly quest with id "${body.id}" already exists` }, { status: 409 });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    await auditLog(service, user.id, "CREATE", "weekly_quest", data.id, null, data);
    return NextResponse.json({ quest: data });
  } catch (res) { return res as Response; }
}

export async function PATCH(req: NextRequest) {
  try {
    const { user, service } = await requireAdmin();
    const body = await req.json();
    const { id, ...updates } = body;
    if (!id) return NextResponse.json({ error: "Missing quest id" }, { status: 400 });

    if (updates.category && !CATEGORIES.includes(updates.category))
      return NextResponse.json({ error: `category must be one of: ${CATEGORIES.join(", ")}` }, { status: 400 });
    if (updates.xp_reward != null && (typeof updates.xp_reward !== "number" || updates.xp_reward < 0))
      return NextResponse.json({ error: "xp_reward must be a non-negative number" }, { status: 400 });

    const { data: before } = await service.from("weekly_quests").select("*").eq("id", id).single();
    const { data, error } = await service.from("weekly_quests").update({
      title: updates.title, description: updates.description, category: updates.category,
      xp_reward: updates.xp_reward, icon: updates.icon, is_active: updates.is_active,
    }).eq("id", id).select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await auditLog(service, user.id, "UPDATE", "weekly_quest", id, before, data);
    return NextResponse.json({ quest: data });
  } catch (res) { return res as Response; }
}

export async function DELETE(req: NextRequest) {
  try {
    const { user, service } = await requireAdmin();
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: "Missing quest id" }, { status: 400 });

    const { count: stepCount } = await service.from("quest_chain_steps")
      .select("id", { count: "exact", head: true }).eq("requires_quest_id", id);
    if ((stepCount ?? 0) > 0)
      return NextResponse.json({ error: `Cannot delete — this quest is required by ${stepCount} quest chain step(s).` }, { status: 409 });

    const { data: before } = await service.from("weekly_quests").select("*").eq("id", id).single();
    const { error } = await service.from("weekly_quests").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await auditLog(service, user.id, "DELETE", "weekly_quest", id, before, null);
    return NextResponse.json({ success: true });
  } catch (res) { return res as Response; }
}