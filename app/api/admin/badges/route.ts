/**
 * app/api/admin/badges/route.ts — Sprint 4 (M4: audit logging added)
 * Validation was already present. requireAdmin() now comes from lib/adminAudit.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, auditLog }    from "@/lib/adminAudit";
import { writeAuditLog } from "@/lib/auditLog";

const CATEGORIES = ["streak", "savings", "quest", "social", "special", "hidden"];
const VISIBILITY = ["visible", "hidden"];

function validate(body: any) {
  if (!body.id || typeof body.id !== "string" || !/^[a-z0-9_]+$/.test(body.id))
    return "id is required and must be lowercase letters, numbers, and underscores only";
  if (!body.title || typeof body.title !== "string") return "title is required";
  if (!body.description || typeof body.description !== "string") return "description is required";
  if (body.category && !CATEGORIES.includes(body.category))
    return `category must be one of: ${CATEGORIES.join(", ")}`;
  if (body.visibility && !VISIBILITY.includes(body.visibility))
    return `visibility must be one of: ${VISIBILITY.join(", ")}`;
  if (body.xp_reward != null && (typeof body.xp_reward !== "number" || body.xp_reward < 0))
    return "xp_reward must be a non-negative number";
  return null;
}

export async function GET() {
  try {
    const { service } = await requireAdmin();
    const { data, error } = await service.from("badges").select("*").order("created_at");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ badges: data });
  } catch (res) { return res as Response; }
}

export async function POST(req: NextRequest) {
  try {
    const { user, service } = await requireAdmin();
    const body = await req.json();
    const validationError = validate(body);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    const { data, error } = await service.from("badges").insert({
      id: body.id, title: body.title, description: body.description,
      unlock_criteria: body.unlock_criteria || body.description,
      category: body.category ?? "special", icon: body.icon ?? "🏅",
      xp_reward: body.xp_reward ?? 0, secret: body.secret ?? false,
      visibility: body.visibility ?? "visible", is_active: body.is_active ?? true,
    }).select().single();

    if (error) {
      if (error.code === "23505")
        return NextResponse.json({ error: `A badge with id "${body.id}" already exists` }, { status: 409 });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    await auditLog(service, user.id, "CREATE", "badge", data.id, null, data);

    // Lightweight cross-reference into the business-event audit_logs table
    // (migration 027), in addition to the richer before/after record
    // auditLog() just wrote to admin_audit_log above. See lib/auditLog.ts
    // header for why these are two separate tables. metadata here is
    // intentionally a summary, not a full row dump — the complete record
    // already lives in admin_audit_log if a fuller reconstruction is needed.
    await writeAuditLog({
      userId:     user.id,
      eventType:  "ADMIN_BADGE_CREATED",
      entityType: "badge",
      entityId:   data.id,
      metadata:   { title: data.title, category: data.category, xp_reward: data.xp_reward },
    });

    return NextResponse.json({ badge: data });
  } catch (res) { return res as Response; }
}

export async function PATCH(req: NextRequest) {
  try {
    const { user, service } = await requireAdmin();
    const body = await req.json();
    const { id, ...updates } = body;
    if (!id) return NextResponse.json({ error: "Missing badge id" }, { status: 400 });

    if (updates.category && !CATEGORIES.includes(updates.category))
      return NextResponse.json({ error: `category must be one of: ${CATEGORIES.join(", ")}` }, { status: 400 });
    if (updates.visibility && !VISIBILITY.includes(updates.visibility))
      return NextResponse.json({ error: `visibility must be one of: ${VISIBILITY.join(", ")}` }, { status: 400 });
    if (updates.xp_reward != null && (typeof updates.xp_reward !== "number" || updates.xp_reward < 0))
      return NextResponse.json({ error: "xp_reward must be a non-negative number" }, { status: 400 });

    const { data: before } = await service.from("badges").select("*").eq("id", id).single();
    const { data, error } = await service.from("badges").update({
      title: updates.title, description: updates.description,
      unlock_criteria: updates.unlock_criteria, category: updates.category,
      icon: updates.icon, xp_reward: updates.xp_reward,
      secret: updates.secret, visibility: updates.visibility, is_active: updates.is_active,
    }).eq("id", id).select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await auditLog(service, user.id, "UPDATE", "badge", id, before, data);
    return NextResponse.json({ badge: data });
  } catch (res) { return res as Response; }
}

export async function DELETE(req: NextRequest) {
  try {
    const { user, service } = await requireAdmin();
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: "Missing badge id" }, { status: 400 });

    const { count } = await service.from("user_achievements")
      .select("id", { count: "exact", head: true }).eq("achievement_id", id);
    if ((count ?? 0) > 0)
      return NextResponse.json({ error: `Cannot delete — ${count} user(s) have earned this badge. Disable it instead.` }, { status: 409 });

    const { count: chainCount } = await service.from("quest_chains")
      .select("id", { count: "exact", head: true }).eq("completion_badge_id", id);
    if ((chainCount ?? 0) > 0)
      return NextResponse.json({ error: `Cannot delete — this badge is the completion reward for ${chainCount} quest chain(s).` }, { status: 409 });

    const { data: before } = await service.from("badges").select("*").eq("id", id).single();
    const { error } = await service.from("badges").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await auditLog(service, user.id, "DELETE", "badge", id, before, null);
    return NextResponse.json({ success: true });
  } catch (res) { return res as Response; }
}