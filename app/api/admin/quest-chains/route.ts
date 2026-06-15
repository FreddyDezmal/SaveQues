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

const REQUIRES_TYPES = ["save_amount", "streak", "complete_quest", "complete_daily", "open_app"];

interface StepInput {
  step_number: number;
  title: string;
  description: string;
  xp_reward: number;
  requires_type: string;
  requires_value: number;
  requires_quest_id?: string | null;
}

function validateChain(body: any) {
  if (!body.id || typeof body.id !== "string" || !/^[a-z0-9_]+$/.test(body.id)) {
    return "id is required and must be lowercase letters, numbers, and underscores only";
  }
  if (!body.title || typeof body.title !== "string") return "title is required";
  if (!body.description || typeof body.description !== "string") return "description is required";
  if (body.completion_xp != null && (typeof body.completion_xp !== "number" || body.completion_xp < 0)) return "completion_xp must be a non-negative number";

  const steps: StepInput[] = body.steps ?? [];
  if (!Array.isArray(steps) || steps.length === 0) return "At least one step is required";

  const stepNumbers = new Set<number>();
  for (const step of steps) {
    if (!step.title || !step.description) return "Each step requires a title and description";
    if (!REQUIRES_TYPES.includes(step.requires_type)) return `Each step's requires_type must be one of: ${REQUIRES_TYPES.join(", ")}`;
    if (typeof step.requires_value !== "number" || step.requires_value < 0) return "Each step's requires_value must be a non-negative number";
    if (typeof step.xp_reward !== "number" || step.xp_reward < 0) return "Each step's xp_reward must be a non-negative number";
    if (typeof step.step_number !== "number" || step.step_number < 1) return "Each step's step_number must be a positive integer";
    if (stepNumbers.has(step.step_number)) return `Duplicate step_number ${step.step_number} — step numbers must be unique`;
    stepNumbers.add(step.step_number);
  }

  return null;
}

// ── READ (list, with steps) ─────────────────────────────────
export async function GET() {
  const authErr = await requireAdmin();
  if (authErr) return authErr;

  const service = createServiceClient();
  const { data: chains, error } = await service.from("quest_chains").select("*").order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: steps, error: stepsError } = await service
    .from("quest_chain_steps")
    .select("*")
    .order("chain_id")
    .order("step_number");
  if (stepsError) return NextResponse.json({ error: stepsError.message }, { status: 500 });

  const chainsWithSteps = (chains ?? []).map(chain => ({
    ...chain,
    steps: (steps ?? []).filter(s => s.chain_id === chain.id),
  }));

  return NextResponse.json({ chains: chainsWithSteps });
}

// ── CREATE (chain + steps) ───────────────────────────────────
export async function POST(req: NextRequest) {
  const authErr = await requireAdmin();
  if (authErr) return authErr;

  const body = await req.json();
  const validationError = validateChain(body);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  const service = createServiceClient();

  const { data: chain, error } = await service
    .from("quest_chains")
    .insert({
      id:                  body.id,
      title:               body.title,
      description:         body.description,
      icon:                body.icon ?? "🔗",
      completion_xp:       body.completion_xp ?? 0,
      completion_badge_id: body.completion_badge_id || null,
      is_active:           body.is_active ?? true,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: `A quest chain with id "${body.id}" already exists` }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const stepRows = (body.steps as StepInput[]).map(s => ({
    chain_id:          body.id,
    step_number:       s.step_number,
    title:             s.title,
    description:       s.description,
    xp_reward:         s.xp_reward,
    requires_type:     s.requires_type,
    requires_value:    s.requires_value,
    requires_quest_id: s.requires_quest_id || null,
  }));

  const { data: steps, error: stepsError } = await service
    .from("quest_chain_steps")
    .insert(stepRows)
    .select();

  if (stepsError) {
    // Roll back the chain so we don't leave a stepless chain behind.
    await service.from("quest_chains").delete().eq("id", body.id);
    return NextResponse.json({ error: stepsError.message }, { status: 500 });
  }

  return NextResponse.json({ chain: { ...chain, steps } });
}

// ── UPDATE (chain fields and/or full step replacement/reorder) ─
export async function PATCH(req: NextRequest) {
  const authErr = await requireAdmin();
  if (authErr) return authErr;

  const body = await req.json();
  const { id, steps, ...updates } = body;
  if (!id) return NextResponse.json({ error: "Missing chain id" }, { status: 400 });

  if (updates.completion_xp != null && (typeof updates.completion_xp !== "number" || updates.completion_xp < 0)) {
    return NextResponse.json({ error: "completion_xp must be a non-negative number" }, { status: 400 });
  }

  const service = createServiceClient();

  const { data: chain, error } = await service
    .from("quest_chains")
    .update({
      title:               updates.title,
      description:         updates.description,
      icon:                updates.icon,
      completion_xp:       updates.completion_xp,
      completion_badge_id: updates.completion_badge_id || null,
      is_active:           updates.is_active,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let resultSteps = null;
  if (Array.isArray(steps)) {
    // Full replacement — supports reordering, edits, additions, and removals
    // in a single call. Validate before touching the DB.
    const stepNumbers = new Set<number>();
    for (const step of steps as StepInput[]) {
      if (!REQUIRES_TYPES.includes(step.requires_type)) {
        return NextResponse.json({ error: `Each step's requires_type must be one of: ${REQUIRES_TYPES.join(", ")}` }, { status: 400 });
      }
      if (stepNumbers.has(step.step_number)) {
        return NextResponse.json({ error: `Duplicate step_number ${step.step_number} — step numbers must be unique` }, { status: 400 });
      }
      stepNumbers.add(step.step_number);
    }

    // Delete existing steps for this chain, then insert the new set.
    // quest_chain_progress.current_step is a plain integer (no FK to
    // quest_chain_steps), so reordering/removing steps does not break
    // existing user progress rows — but a user mid-chain may see their
    // current step renumbered. This is an accepted tradeoff for admin
    // reordering; the UI should warn admins when a chain has active users.
    const { error: deleteError } = await service.from("quest_chain_steps").delete().eq("chain_id", id);
    if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

    const stepRows = (steps as StepInput[]).map(s => ({
      chain_id:          id,
      step_number:       s.step_number,
      title:             s.title,
      description:       s.description,
      xp_reward:         s.xp_reward,
      requires_type:     s.requires_type,
      requires_value:    s.requires_value,
      requires_quest_id: s.requires_quest_id || null,
    }));

    const { data: newSteps, error: insertError } = await service
      .from("quest_chain_steps")
      .insert(stepRows)
      .select();

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
    resultSteps = newSteps;
  }

  return NextResponse.json({ chain: { ...chain, ...(resultSteps ? { steps: resultSteps } : {}) } });
}

// ── DELETE ────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const authErr = await requireAdmin();
  if (authErr) return authErr;

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing chain id" }, { status: 400 });

  const service = createServiceClient();

  // Guard: refuse hard delete if any user has progress on this chain.
  const { count } = await service
    .from("quest_chain_progress")
    .select("id", { count: "exact", head: true })
    .eq("chain_id", id);

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: `Cannot delete — ${count} user(s) have progress on this chain. Disable it instead.` },
      { status: 409 }
    );
  }

  // quest_chain_steps cascade-deletes via FK ON DELETE CASCADE.
  const { error } = await service.from("quest_chains").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
