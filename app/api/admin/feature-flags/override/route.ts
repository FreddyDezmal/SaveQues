/**
 * app/api/admin/feature-flags/override/route.ts
 *
 * Per-user overrides ("developer overrides" in the sprint brief) —
 * force a flag on or off for one specific user regardless of its
 * rollout percentage. Used for QA verification and staged internal
 * testing before a wider rollout.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, auditLog }    from "@/lib/adminAudit";

export async function POST(req: NextRequest) {
  try {
    const { user, service } = await requireAdmin(req, "admin.feature-flags.override.POST");
    const body = await req.json();
    const { flagKey, userId, isEnabled, reason } = body;

    if (!flagKey || typeof flagKey !== "string")
      return NextResponse.json({ error: "flagKey is required" }, { status: 400 });
    if (!userId || typeof userId !== "string")
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    if (typeof isEnabled !== "boolean")
      return NextResponse.json({ error: "isEnabled must be a boolean" }, { status: 400 });

    const { data: flag } = await service.from("feature_flags").select("key").eq("key", flagKey).single();
    if (!flag) return NextResponse.json({ error: `No feature flag with key "${flagKey}"` }, { status: 404 });

    const { data: before } = await service
      .from("feature_flag_overrides").select("*")
      .eq("flag_key", flagKey).eq("user_id", userId).maybeSingle();

    const { data, error } = await service
      .from("feature_flag_overrides")
      .upsert(
        { flag_key: flagKey, user_id: userId, is_enabled: isEnabled, reason: reason ?? null, created_by: user.id },
        { onConflict: "flag_key,user_id" }
      )
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await auditLog(
      service, user.id, before ? "UPDATE" : "CREATE",
      "feature_flag_override", `${flagKey}:${userId}`, before ?? null, data
    );

    return NextResponse.json({ override: data });
  } catch (res) { return res as Response; }
}

export async function DELETE(req: NextRequest) {
  try {
    const { user, service } = await requireAdmin(req, "admin.feature-flags.override.DELETE");
    const { flagKey, userId } = await req.json();

    if (!flagKey || !userId)
      return NextResponse.json({ error: "flagKey and userId are required" }, { status: 400 });

    const { data: before } = await service
      .from("feature_flag_overrides").select("*")
      .eq("flag_key", flagKey).eq("user_id", userId).maybeSingle();
    if (!before) return NextResponse.json({ error: "No override found for that flag and user" }, { status: 404 });

    const { error } = await service
      .from("feature_flag_overrides").delete()
      .eq("flag_key", flagKey).eq("user_id", userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await auditLog(service, user.id, "DELETE", "feature_flag_override", `${flagKey}:${userId}`, before, null);
    return NextResponse.json({ success: true });
  } catch (res) { return res as Response; }
}