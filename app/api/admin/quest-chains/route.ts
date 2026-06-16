/**
 * app/api/admin/quest-chains/route.ts — Sprint 4 (M4: audit logging added)
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, auditLog }    from "@/lib/adminAudit";

const REQUIRES_TYPES = ["save_amount", "streak", "complete_quest", "complete_daily", "open_app"];

interface StepInput {
  step_number: number; title: string; description: string;
  xp_reward: number; requires_type: string;
  requires_value: number; requires_quest_id?: string | null;
}

function validateChain(body: any) {
  if (!body.id || typeof body.id !== "string" || !/^[a-z0-9_]+$/.test(body.id))
    return "id is required and must be lowercase letters, numbers, and underscores only";
  if (!body.title || typeof body.title !== "string") return "title is required";
  if (!body.description || typeof body.description !== "string") return "description is required";
  if (body.completion_xp != null && (typeof body.completion_xp !== "number" || body.completion_xp < 0))
    return "completion_xp must be a non-negative number";
  const steps: StepInput[] = body.steps ?? [];
  if (!Array.isArray(steps) || steps.length === 0) return "At least one step is required";
  const stepNumbers = new Set<number>();
  for (const step of steps) {
    if (!step.title || !step.description) return "Each step requires a title and description";
    if (!REQUIRES_TYPES.includes(step.requires_type))
      return `Each step's requires_type must be one of: ${REQUIRES_TYPES.join(", ")}`;
    if (typeof step.requires_value !== "number" || step.requires_value < 0)
      return "Each step's requires_value must be a non-negative number";
    if (typeof step.xp_reward !== "number" || step.xp_reward < 0)
      return "Each step's xp_reward must be a non-negative number";
    if (typeof step.step_number !== "number" || step.step_number < 1)
      return "Each step's step_number must be a positive integer";
    if (stepNumbers.has(step.step_number))
      return `Duplicate step_number ${step.step_number} — step numbers must be unique`;
    stepNumbers.add(step.step_number);
  }
  return null;
}

export async function GET() {
  try {
    const { service } = await requireAdmin();
    const { data: chains, error } = await service.from("quest_chains").select("*").order("created_at");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const { data: steps, error: stepsError } = await service
      .from("quest_chain_steps").select("*").order("chain_id").order("step_number");
    if (stepsError) return NextResponse.json({ error: stepsError.message }, { status: 500 });
    const chainsWithSteps = (chains ?? []).map(chain => ({
      ...chain, steps: (steps ?? []).filter(s => s.chain_id === chain.id),
    }));
    return NextResponse.json({ chains: chainsWithSteps });
  } catch (res) { return res as Response; }
}

export async function POST(req: NextRequest) {
  try {
    const { user, service } = await requireAdmin();
    const body = await req.json();
    const validationError = validateChain(body);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    const { data: chain, error } = await service.from("quest_chains").insert({
      id: body.id, title: body.title, description: body.description,
      icon: body.icon ?? "🔗", completion_xp: body.completion_xp ?? 0,
      completion_badge_id: body.completion_badge_id || null, is_active: body.is_active ?? true,
    }).select().single();

    if (error) {
      if (error.code === "23505")
        return NextResponse.json({ error: `A quest chain with id "${body.id}" already exists` }, { status: 409 });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const stepRows = (body.steps as StepInput[]).map(s => ({
      chain_id: body.id, step_number: s.step_number, title: s.title,
      description: s.description, xp_reward: s.xp_reward,
      requires_type: s.requires_type, requires_value: s.requires_value,
      requires_quest_id: s.requires_quest_id || null,
    }));

    const { data: steps, error: stepsError } = await service.from("quest_chain_steps").insert(stepRows).select();
    if (stepsError) {
      await service.from("quest_chains").delete().eq("id", body.id);
      return NextResponse.json({ error: stepsError.message }, { status: 500 });
    }

    await auditLog(service, user.id, "CREATE", "quest_chain", chain.id, null, { ...chain, steps });
    return NextResponse.json({ chain: { ...chain, steps } });
  } catch (res) { return res as Response; }
}

export async function PATCH(req: NextRequest) {
  try {
    const { user, service } = await requireAdmin();
    const body = await req.json();
    const { id, steps, ...updates } = body;
    if (!id) return NextResponse.json({ error: "Missing chain id" }, { status: 400 });

    if (updates.completion_xp != null && (typeof updates.completion_xp !== "number" || updates.completion_xp < 0))
      return NextResponse.json({ error: "completion_xp must be a non-negative number" }, { status: 400 });

    const { data: before } = await service.from("quest_chains").select("*").eq("id", id).single();
    const { data: beforeSteps } = await service.from("quest_chain_steps").select("*").eq("chain_id", id).order("step_number");

    const { data: chain, error } = await service.from("quest_chains").update({
      title: updates.title, description: updates.description, icon: updates.icon,
      completion_xp: updates.completion_xp,
      completion_badge_id: updates.completion_badge_id || null, is_active: updates.is_active,
    }).eq("id", id).select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    let resultSteps = null;
    if (Array.isArray(steps)) {
      const stepNumbers = new Set<number>();
      for (const step of steps as StepInput[]) {
        if (!REQUIRES_TYPES.includes(step.requires_type))
          return NextResponse.json({ error: `Each step's requires_type must be one of: ${REQUIRES_TYPES.join(", ")}` }, { status: 400 });
        if (stepNumbers.has(step.step_number))
          return NextResponse.json({ error: `Duplicate step_number ${step.step_number}` }, { status: 400 });
        stepNumbers.add(step.step_number);
      }
      const { error: deleteError } = await service.from("quest_chain_steps").delete().eq("chain_id", id);
      if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });
      const stepRows = (steps as StepInput[]).map(s => ({
        chain_id: id, step_number: s.step_number, title: s.title,
        description: s.description, xp_reward: s.xp_reward,
        requires_type: s.requires_type, requires_value: s.requires_value,
        requires_quest_id: s.requires_quest_id || null,
      }));
      const { data: newSteps, error: insertError } = await service.from("quest_chain_steps").insert(stepRows).select();
      if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
      resultSteps = newSteps;
    }

    await auditLog(service, user.id, "UPDATE", "quest_chain", id,
      { ...before, steps: beforeSteps },
      { ...chain, ...(resultSteps ? { steps: resultSteps } : {}) }
    );
    return NextResponse.json({ chain: { ...chain, ...(resultSteps ? { steps: resultSteps } : {}) } });
  } catch (res) { return res as Response; }
}

export async function DELETE(req: NextRequest) {
  try {
    const { user, service } = await requireAdmin();
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: "Missing chain id" }, { status: 400 });

    const { count } = await service.from("quest_chain_progress")
      .select("id", { count: "exact", head: true }).eq("chain_id", id);
    if ((count ?? 0) > 0)
      return NextResponse.json({ error: `Cannot delete — ${count} user(s) have progress on this chain.` }, { status: 409 });

    const { data: before } = await service.from("quest_chains").select("*").eq("id", id).single();
    const { data: beforeSteps } = await service.from("quest_chain_steps").select("*").eq("chain_id", id);
    const { error } = await service.from("quest_chains").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await auditLog(service, user.id, "DELETE", "quest_chain", id, { ...before, steps: beforeSteps }, null);
    return NextResponse.json({ success: true });
  } catch (res) { return res as Response; }
}
