/**
 * app/api/experiments/route.ts
 *
 * Returns the CURRENT user's experiment assignments as { [key]: variantId }.
 * Mirrors app/api/feature-flags/route.ts's shape/behavior deliberately —
 * same "never break the page that asked" fail-closed philosophy, same
 * private no-cache-by-CDN header reasoning. Unlike feature flags, this
 * requires a real logged-in user (an anonymous visitor can't have a
 * sticky assignment persisted for them), so this route 401s without one
 * rather than silently evaluating "anonymous".
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { getExperimentAssignments } from "@/lib/experiments";
import { createLogger } from "@/lib/logger";

const log = createLogger("api.experiments");

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const assignments = await getExperimentAssignments(user.id);
    return NextResponse.json({ assignments }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    log.error("Experiment assignment failed", {
      user_id: user.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ assignments: {} }, { status: 200 });
  }
}