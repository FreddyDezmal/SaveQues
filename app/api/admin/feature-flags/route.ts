/**
 * app/api/admin/feature-flags/route.ts
 *
 * Admin CRUD for feature_flags (migration 059). Follows the same shape
 * as app/api/admin/badges/route.ts: requireAdmin() for auth/rate-limit/
 * access-logging, the service-role client for the actual write (RLS
 * intentionally grants no write policy to `authenticated` — see the
 * migration header), and auditLog() for the before/after admin trail.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, auditLog }    from "@/lib/adminAudit";

function validate(body: any) {
  if (!body.key || typeof body.key !== "string" || !/^[a-z0-9_]+$/.test(body.key))
    return "key is required and must be lowercase letters, numbers, and underscores only";
  if (!body.name || typeof body.name !== "string") return "name is required";
  if (body.rollout_percentage != null) {
    const p = body.rollout_percentage;
    if (typeof p !== "number" || p < 0 || p > 100) return "rollout_percentage must be a number between 0 and 100";
  }
  if (body.enabled_environments != null) {
    if (!Array.isArray(body.enabled_environments) || body.enabled_environments.some((e: unknown) => typeof e !== "string"))
      return "enabled_environments must be an array of strings";
  }
  if (body.is_enabled != null && typeof body.is_enabled !== "boolean")
    return "is_enabled must be a boolean";
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const { service } = await requireAdmin(req, "admin.feature-flags.GET");
    const { data, error } = await service.from("feature_flags").select("*").order("created_at");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ flags: data });
  } catch (res) { return res as Response; }
}

export async function POST(req: NextRequest) {
  try {
    const { user, service } = await requireAdmin(req, "admin.feature-flags.POST");
    const body = await req.json();
    const validationError = validate(body);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    const { data, error } = await service.from("feature_flags").insert({
      key:                  body.key,
      name:                 body.name,
      description:          body.description ?? null,
      is_enabled:           body.is_enabled ?? false,
      rollout_percentage:   body.rollout_percentage ?? 0,
      enabled_environments: body.enabled_environments ?? [],
      created_by:           user.id,
      updated_by:           user.id,
    }).select().single();

    if (error) {
      if (error.code === "23505")
        return NextResponse.json({ error: `A feature flag with key "${body.key}" already exists` }, { status: 409 });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    await auditLog(service, user.id, "CREATE", "feature_flag", data.key, null, data);
    return NextResponse.json({ flag: data }, { status: 201 });
  } catch (res) { return res as Response; }
}

export async function PATCH(req: NextRequest) {
  try {
    const { user, service } = await requireAdmin(req, "admin.feature-flags.PATCH");
    const { key, ...updates } = await req.json();
    if (!key) return NextResponse.json({ error: "Missing flag key" }, { status: 400 });

    const validationError = validate({ key, ...updates });
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    const { data: before } = await service.from("feature_flags").select("*").eq("key", key).single();
    if (!before) return NextResponse.json({ error: `No feature flag with key "${key}"` }, { status: 404 });

    const { data, error } = await service.from("feature_flags").update({
      name:                 updates.name                 ?? before.name,
      description:          updates.description           ?? before.description,
      is_enabled:           updates.is_enabled            ?? before.is_enabled,
      rollout_percentage:   updates.rollout_percentage    ?? before.rollout_percentage,
      enabled_environments: updates.enabled_environments  ?? before.enabled_environments,
      updated_by:           user.id,
    }).eq("key", key).select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await auditLog(service, user.id, "UPDATE", "feature_flag", key, before, data);
    return NextResponse.json({ flag: data });
  } catch (res) { return res as Response; }
}

export async function DELETE(req: NextRequest) {
  try {
    const { user, service } = await requireAdmin(req, "admin.feature-flags.DELETE");
    const { key } = await req.json();
    if (!key) return NextResponse.json({ error: "Missing flag key" }, { status: 400 });

    const { data: before } = await service.from("feature_flags").select("*").eq("key", key).single();
    if (!before) return NextResponse.json({ error: `No feature flag with key "${key}"` }, { status: 404 });

    // Overrides cascade-delete (ON DELETE CASCADE, migration 059), so no
    // separate cleanup query is needed here — unlike badges' delete route,
    // which has to check for dependent rows because user_achievements
    // does NOT cascade. Worth calling out explicitly since it's the
    // opposite of the badges pattern for a reason (an override is
    // meaningless without the flag it overrides; an earned badge should
    // never silently disappear).
    const { error } = await service.from("feature_flags").delete().eq("key", key);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await auditLog(service, user.id, "DELETE", "feature_flag", key, before, null);
    return NextResponse.json({ success: true });
  } catch (res) { return res as Response; }
}