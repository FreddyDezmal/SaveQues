/**
 * app/api/admin/events/route.ts  — Sprint 4
 *
 * Changes from original:
 *  H1 — Full input validation on POST and PATCH (slug, title, description,
 *         event_type, xp_reward, dates, preview_days, is_annual).
 *       Payload errors return 400 with a descriptive message instead of
 *       propagating as DB constraint violations (500).
 *  M4 — Every mutation (CREATE / UPDATE / DELETE) is written to admin_audit_log.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, auditLog }    from "@/lib/adminAudit";

// ── Constants ─────────────────────────────────────────────────
const EVENT_TYPES  = ["seasonal", "calendar", "savequest", "evergreen"] as const;
const SLUG_RE      = /^[a-z0-9_-]+$/;
const DATE_RE      = /^\d{4}-\d{2}-\d{2}$/;
const MAX_XP       = 10_000;
const MAX_PREVIEW  = 365;

// ── Validation helpers ────────────────────────────────────────
function isValidDate(value: unknown): boolean {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const d = new Date(value);
  return !isNaN(d.getTime());
}

interface ValidationErrors { [field: string]: string }

function validatePost(body: any): ValidationErrors {
  const errors: ValidationErrors = {};

  // slug
  if (!body.slug || typeof body.slug !== "string") {
    errors.slug = "slug is required";
  } else if (!SLUG_RE.test(body.slug)) {
    errors.slug = "slug must be lowercase letters, numbers, hyphens, and underscores only";
  } else if (body.slug.length > 100) {
    errors.slug = "slug must be 100 characters or fewer";
  }

  // title
  if (!body.title || typeof body.title !== "string") {
    errors.title = "title is required";
  } else if (body.title.trim().length < 3) {
    errors.title = "title must be at least 3 characters";
  } else if (body.title.length > 200) {
    errors.title = "title must be 200 characters or fewer";
  }

  // description
  if (!body.description || typeof body.description !== "string") {
    errors.description = "description is required";
  } else if (body.description.trim().length < 10) {
    errors.description = "description must be at least 10 characters";
  }

  // event_type
  if (body.event_type !== undefined && !EVENT_TYPES.includes(body.event_type)) {
    errors.event_type = `event_type must be one of: ${EVENT_TYPES.join(", ")}`;
  }

  // xp_reward
  if (body.xp_reward !== undefined) {
    if (typeof body.xp_reward !== "number" || !Number.isInteger(body.xp_reward)) {
      errors.xp_reward = "xp_reward must be an integer";
    } else if (body.xp_reward < 0) {
      errors.xp_reward = "xp_reward must be non-negative";
    } else if (body.xp_reward > MAX_XP) {
      errors.xp_reward = `xp_reward must be ${MAX_XP} or fewer`;
    }
  }

  // available_from / available_until
  if (body.available_from !== undefined && body.available_from !== null) {
    if (!isValidDate(body.available_from)) {
      errors.available_from = "available_from must be a valid ISO date (YYYY-MM-DD)";
    }
  }
  if (body.available_until !== undefined && body.available_until !== null) {
    if (!isValidDate(body.available_until)) {
      errors.available_until = "available_until must be a valid ISO date (YYYY-MM-DD)";
    }
  }
  if (
    body.available_from && body.available_until &&
    isValidDate(body.available_from) && isValidDate(body.available_until) &&
    new Date(body.available_until) <= new Date(body.available_from)
  ) {
    errors.available_until = "available_until must be after available_from";
  }

  // preview_days
  if (body.preview_days !== undefined) {
    if (typeof body.preview_days !== "number" || !Number.isInteger(body.preview_days)) {
      errors.preview_days = "preview_days must be an integer";
    } else if (body.preview_days < 0) {
      errors.preview_days = "preview_days must be non-negative";
    } else if (body.preview_days > MAX_PREVIEW) {
      errors.preview_days = `preview_days must be ${MAX_PREVIEW} or fewer`;
    }
  }

  // is_annual
  if (body.is_annual !== undefined && typeof body.is_annual !== "boolean") {
    errors.is_annual = "is_annual must be a boolean";
  }

  return errors;
}

function validatePatch(updates: any): ValidationErrors {
  const errors: ValidationErrors = {};

  if (updates.title !== undefined) {
    if (typeof updates.title !== "string" || updates.title.trim().length < 3) {
      errors.title = "title must be at least 3 characters";
    } else if (updates.title.length > 200) {
      errors.title = "title must be 200 characters or fewer";
    }
  }

  if (updates.description !== undefined) {
    if (typeof updates.description !== "string" || updates.description.trim().length < 10) {
      errors.description = "description must be at least 10 characters";
    }
  }

  if (updates.event_type !== undefined && !EVENT_TYPES.includes(updates.event_type)) {
    errors.event_type = `event_type must be one of: ${EVENT_TYPES.join(", ")}`;
  }

  if (updates.xp_reward !== undefined) {
    if (typeof updates.xp_reward !== "number" || !Number.isInteger(updates.xp_reward)) {
      errors.xp_reward = "xp_reward must be an integer";
    } else if (updates.xp_reward < 0) {
      errors.xp_reward = "xp_reward must be non-negative";
    } else if (updates.xp_reward > MAX_XP) {
      errors.xp_reward = `xp_reward must be ${MAX_XP} or fewer`;
    }
  }

  if (updates.available_from !== undefined && updates.available_from !== null) {
    if (!isValidDate(updates.available_from)) {
      errors.available_from = "available_from must be a valid ISO date (YYYY-MM-DD)";
    }
  }

  if (updates.available_until !== undefined && updates.available_until !== null) {
    if (!isValidDate(updates.available_until)) {
      errors.available_until = "available_until must be a valid ISO date (YYYY-MM-DD)";
    }
  }

  if (updates.available_from && updates.available_until &&
      isValidDate(updates.available_from) && isValidDate(updates.available_until) &&
      new Date(updates.available_until) <= new Date(updates.available_from)) {
    errors.available_until = "available_until must be after available_from";
  }

  if (updates.preview_days !== undefined) {
    if (typeof updates.preview_days !== "number" || !Number.isInteger(updates.preview_days)) {
      errors.preview_days = "preview_days must be an integer";
    } else if (updates.preview_days < 0) {
      errors.preview_days = "preview_days must be non-negative";
    } else if (updates.preview_days > MAX_PREVIEW) {
      errors.preview_days = `preview_days must be ${MAX_PREVIEW} or fewer`;
    }
  }

  if (updates.is_annual !== undefined && typeof updates.is_annual !== "boolean") {
    errors.is_annual = "is_annual must be a boolean";
  }

  return errors;
}

// ── READ ──────────────────────────────────────────────────────
export async function GET() {
  try {
    const { service } = await requireAdmin();
    const { data, error } = await service.from("events").select("*").order("created_at");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ events: data });
  } catch (res) { return res as Response; }
}

// ── CREATE ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { user, service } = await requireAdmin();
    const body = await req.json();

    const errors = validatePost(body);
    if (Object.keys(errors).length > 0) {
      return NextResponse.json({ error: "Validation failed", fields: errors }, { status: 400 });
    }

    const { data, error } = await service
      .from("events")
      .insert({
        slug:            body.slug,
        title:           body.title.trim(),
        description:     body.description.trim(),
        emoji:           body.emoji ?? "⚡",
        event_type:      body.event_type ?? "savequest",
        xp_reward:       body.xp_reward ?? 200,
        available_from:  body.available_from  || null,
        available_until: body.available_until || null,
        is_annual:       body.is_annual ?? false,
        preview_days:    body.preview_days ?? 5,
        is_active:       body.is_active ?? true,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: `An event with slug "${body.slug}" already exists` },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await auditLog(service, user.id, "CREATE", "event", data.id, null, data);
    return NextResponse.json({ event: data });
  } catch (res) { return res as Response; }
}

// ── UPDATE ────────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  try {
    const { user, service } = await requireAdmin();
    const body = await req.json();
    const { id, ...updates } = body;
    if (!id) return NextResponse.json({ error: "Missing event id" }, { status: 400 });

    const errors = validatePatch(updates);
    if (Object.keys(errors).length > 0) {
      return NextResponse.json({ error: "Validation failed", fields: errors }, { status: 400 });
    }

    // Capture before state for audit
    const { data: before } = await service.from("events").select("*").eq("id", id).single();

    const { data, error } = await service
      .from("events")
      .update({
        title:           updates.title?.trim(),
        description:     updates.description?.trim(),
        emoji:           updates.emoji,
        event_type:      updates.event_type,
        xp_reward:       updates.xp_reward,
        available_from:  updates.available_from  || null,
        available_until: updates.available_until || null,
        is_annual:       updates.is_annual,
        preview_days:    updates.preview_days,
        is_active:       updates.is_active,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await auditLog(service, user.id, "UPDATE", "event", id, before, data);
    return NextResponse.json({ event: data });
  } catch (res) { return res as Response; }
}

// ── DELETE ────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const { user, service } = await requireAdmin();
    const { id, slug } = await req.json();
    if (!id || !slug) return NextResponse.json({ error: "Missing id or slug" }, { status: 400 });

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

    // Capture before state for audit
    const { data: before } = await service.from("events").select("*").eq("id", id).single();

    const { error } = await service.from("events").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await auditLog(service, user.id, "DELETE", "event", id, before, null);
    return NextResponse.json({ success: true });
  } catch (res) { return res as Response; }
}