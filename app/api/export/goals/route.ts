/**
 * app/api/export/goals/route.ts
 *
 * GET — downloads the caller's own savings goals as CSV. Same
 * own-data-only pattern as export/transactions/route.ts.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkAttemptRateLimit, recordAttempt } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";
import { goalsToCSV } from "@/lib/exportCenter";
import { enforceUsageLimit, recordUsage } from "@/lib/billing/gate";
import type { SavingsGoal } from "@/lib/types";

const log = createLogger("export.goals");
const RATE_LIMIT_ENDPOINT = "export.goals";

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = await checkAttemptRateLimit(supabase, {
    userId: user.id,
    endpoint: RATE_LIMIT_ENDPOINT,
    windowMinutes: 60,
    maxRequests: 20,
    actionLabel: "exports",
  });
  await recordAttempt(supabase, user.id, RATE_LIMIT_ENDPOINT);
  if (!limit.allowed) {
    return NextResponse.json({ error: limit.message }, { status: 429 });
  }

  // Sprint 29 — Premium Subscription Platform, Phase 5: see the matching
  // comment in app/api/export/transactions/route.ts.
  const { blocked } = await enforceUsageLimit(user.id, "exports_limit", "monthly export");
  if (blocked) return blocked;

  const [{ data, error }, { data: profileData }] = await Promise.all([
    supabase
      .from("savings_goals")
      .select("id, user_id, title, category, goal_emoji, target_amount, current_amount, target_date, is_complete, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase.from("profiles").select("currency_code").eq("id", user.id).single(),
  ]);

  if (error) {
    log.error("export.goals failed", { user_id: user.id, error: error.message });
    return NextResponse.json({ error: "Couldn't build that export right now." }, { status: 500 });
  }

  const csv = goalsToCSV((data ?? []) as SavingsGoal[], profileData?.currency_code ?? "ZAR");

  await recordUsage(user.id, "exports_limit");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="savequest-goals.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
