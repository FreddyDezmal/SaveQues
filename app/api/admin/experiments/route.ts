/**
 * app/api/admin/experiments/route.ts
 *
 * Admin CRUD for experiments (migration 060). Same shape as
 * app/api/admin/feature-flags/route.ts: requireAdmin() for auth/rate-limit/
 * access-logging, the service-role client for the write (RLS grants no
 * write policy to `authenticated` — see the migration header), and
 * auditLog() for the before/after admin trail.
 *
 * Deleting or editing variants on a RUNNING experiment does not touch
 * experiment_assignments — existing assignments stay exactly as they
 * were persisted (see lib/experiments.ts's getOrCreateAssignment()
 * docstring: "never reassigns"). Changing status to "archived"/"completed"
 * is the intended way to stop new assignments from being created, not
 * deleting the experiment row.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, auditLog }    from "@/lib/adminAudit";
import { validateVariants }          from "@/lib/experiments";

function validate(body: any) {
  if (!body.key || typeof body.key !== "string" || !/^[a-z0-9_]+$/.test(body.key))
    return "key is required and must be lowercase letters, numbers, and underscores only";
  if (!body.name || typeof body.name !== "string") return "name is required";
  if (body.status != null && !["draft", "running", "completed", "archived"].includes(body.status))
    return "status must be one of draft, running, completed, archived";
  if (body.variants != null) {
    const variantsError = validateVariants(body.variants);
    if (variantsError) return variantsError;
  }
  if (body.traffic_allocation_percentage != null) {
    const p = body.traffic_allocation_percentage;
    if (typeof p !== "number" || p < 0 || p > 100) return "traffic_allocation_percentage must be a number between 0 and 100";
  }
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const { service } = await requireAdmin(req, "admin.experiments.GET");
    const { data, error } = await service.from("experiments").select("*").order("created_at");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ experiments: data });
  } catch (res) { return res as Response; }
}

export async function POST(req: NextRequest) {
  try {
    const { user, service } = await requireAdmin(req, "admin.experiments.POST");
    const body = await req.json();
    const validationError = validate(body);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    const { data, error } = await service.from("experiments").insert({
      key:                            body.key,
      name:                           body.name,
      description:                   body.description ?? null,
      status:                         body.status ?? "draft",
      variants:                       body.variants ?? [],
      traffic_allocation_percentage: body.traffic_allocation_percentage ?? 100,
      created_by:                     user.id,
      updated_by:                     user.id,
    }).select().single();

    if (error) {
      if (error.code === "23505")
        return NextResponse.json({ error: `An experiment with key "${body.key}" already exists` }, { status: 409 });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    await auditLog(service, user.id, "CREATE", "experiment", data.key, null, data);
    return NextResponse.json({ experiment: data }, { status: 201 });
  } catch (res) { return res as Response; }
}

export async function PATCH(req: NextRequest) {
  try {
    const { user, service } = await requireAdmin(req, "admin.experiments.PATCH");
    const { key, ...updates } = await req.json();
    if (!key) return NextResponse.json({ error: "Missing experiment key" }, { status: 400 });

    const validationError = validate({ key, ...updates });
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    const { data: before } = await service.from("experiments").select("*").eq("key", key).single();
    if (!before) return NextResponse.json({ error: `No experiment with key "${key}"` }, { status: 404 });

    const { data, error } = await service.from("experiments").update({
      name:                           updates.name                           ?? before.name,
      description:                   updates.description                   ?? before.description,
      status:                         updates.status                         ?? before.status,
      variants:                       updates.variants                       ?? before.variants,
      traffic_allocation_percentage: updates.traffic_allocation_percentage ?? before.traffic_allocation_percentage,
      updated_by:                     user.id,
    }).eq("key", key).select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await auditLog(service, user.id, "UPDATE", "experiment", key, before, data);
    return NextResponse.json({ experiment: data });
  } catch (res) { return res as Response; }
}

export async function DELETE(req: NextRequest) {
  try {
    const { user, service } = await requireAdmin(req, "admin.experiments.DELETE");
    const { key } = await req.json();
    if (!key) return NextResponse.json({ error: "Missing experiment key" }, { status: 400 });

    const { data: before } = await service.from("experiments").select("*").eq("key", key).single();
    if (!before) return NextResponse.json({ error: `No experiment with key "${key}"` }, { status: 404 });

    // experiment_assignments cascade-deletes (ON DELETE CASCADE, migration
    // 060) — deleting an experiment also erases everyone's assignment
    // history for it. Prefer PATCHing status to "archived" over DELETE if
    // that history has analytics value; DELETE is for cleaning up an
    // experiment that was created by mistake.
    const { error } = await service.from("experiments").delete().eq("key", key);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await auditLog(service, user.id, "DELETE", "experiment", key, before, null);
    return NextResponse.json({ success: true });
  } catch (res) { return res as Response; }
}