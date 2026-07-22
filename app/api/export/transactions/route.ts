/**
 * app/api/export/transactions/route.ts
 *
 * GET — downloads the caller's own transactions as CSV. Own-data only:
 * the session client (RLS-respecting, not the service-role client) is
 * used for the actual fetch, and the query additionally filters
 * `.eq("user_id", user.id)` as defence-in-depth — same "belt and
 * braces" pattern already used elsewhere (e.g. app/api/goal/edit).
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkAttemptRateLimit, recordAttempt } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";
import { transactionsToCSV } from "@/lib/exportCenter";
import type { Transaction, SavingsGoal } from "@/lib/types";

const log = createLogger("export.transactions");
const RATE_LIMIT_ENDPOINT = "export.transactions";

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

  const [{ data: txData, error: txError }, { data: goalData, error: goalError }] = await Promise.all([
    supabase
      .from("transactions")
      .select("id, user_id, goal_id, amount, note, transaction_type, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase.from("savings_goals").select("id, title, category").eq("user_id", user.id),
  ]);

  if (txError || goalError) {
    log.error("export.transactions failed", { user_id: user.id, error: (txError ?? goalError)?.message });
    return NextResponse.json({ error: "Couldn't build that export right now." }, { status: 500 });
  }

  const csv = transactionsToCSV((txData ?? []) as Transaction[], (goalData ?? []) as Pick<SavingsGoal, "id" | "title" | "category">[]);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="savequest-transactions.csv"`,
      // Never cache — this is a per-user financial export, must never be
      // served to a different user from a shared/CDN cache.
      "Cache-Control": "private, no-store",
    },
  });
}
