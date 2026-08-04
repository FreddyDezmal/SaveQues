/**
 * app/api/shared-goals/detail/route.ts
 *
 * Full detail for one shared goal via public.get_shared_goal_detail()
 * (049, reshaped by 072) — real target/current amounts, owner + group
 * cards, per-member contribution totals. See 049's file header for why
 * exposing real amounts here is a deliberate, scoped exception to the
 * feed's no-amounts rule. Returns 404 for both "doesn't exist" and "you
 * can't see this" — the RPC itself doesn't distinguish them.
 *
 * SPRINT 31 — PHASE 9: the RPC (072) intentionally stops at a
 * per-currency breakdown — SQL only ever sums amounts that share a
 * currency_code (safe). Converting those groups into one number in the
 * goal owner's currency happens HERE, via lib/currencyConversion.ts
 * (Phase 7) — this is the one place that conversion is allowed to
 * happen for this feature. Never in the RPC (no exchange-rate cache
 * access from SQL), never in SharedGoalDetailClient.tsx (no business
 * logic in the UI layer, per the sprint's own principle).
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { resolveRates, convertAmount } from "@/lib/currencyConversion";
import type { ExchangeRate } from "@/lib/exchangeRates/types";

const log = createLogger("sharedGoals.detail");

interface CurrencyAmount {
  currency_code: string;
  amount: number;
}

interface RawMember {
  member_id: string;
  user_id: string;
  username: string | null;
  display_name: string;
  avatar_emoji: string | null;
  status: string;
  contributions_by_currency: CurrencyAmount[];
}

/**
 * Sums a list of {currency_code, amount} groups into one total in
 * toCurrency, using ALREADY-RESOLVED rates (see resolveRates below) —
 * pure local math, no I/O of its own.
 *
 * SPRINT 31 — PHASE 13 (Performance Audit): this used to call
 * convertAmountsTo() (which does its own cache read) once per member PLUS
 * once for the goal-level total — up to (member count + 1) separate DB
 * round-trips for one page load. Now the route resolves every distinct
 * currency across the whole response in ONE batched call up front (see
 * GET below), and this function just does arithmetic against that
 * already-resolved Map.
 */
function sumInCurrency(groups: CurrencyAmount[], toCurrency: string, rates: Map<string, ExchangeRate>): number {
  if (groups.length === 0) return 0;
  const toRate = rates.get(toCurrency)!;
  return groups.reduce((sum, g) => sum + convertAmount(g.amount, rates.get(g.currency_code)!, toRate).amount, 0);
}

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sharedGoalId = req.nextUrl.searchParams.get("sharedGoalId");
  if (!sharedGoalId) {
    return NextResponse.json({ error: "sharedGoalId required" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("get_shared_goal_detail", { p_shared_goal_id: sharedGoalId });

  if (error) {
    log.error("get_shared_goal_detail RPC failed", { user_id: user.id, shared_goal_id: sharedGoalId, error: error.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ownerCurrency = data.owner?.currency_code ?? "ZAR";
  const members: RawMember[] = data.members ?? [];
  const totalGroupContributionsByCurrency: CurrencyAmount[] = data.total_group_contributions_by_currency ?? [];

  const distinctCurrencies = new Set([
    ...totalGroupContributionsByCurrency.map((g) => g.currency_code),
    ...members.flatMap((m) => m.contributions_by_currency.map((g) => g.currency_code)),
  ]);
  // Only worth telling the client "these were converted" when there's
  // actually more than one currency in play, or the one currency present
  // isn't already the owner's — avoids a conversion note appearing for
  // every single-currency (today, the vast majority of) shared goals.
  const involvesConversion = Array.from(distinctCurrencies).some((c) => c !== ownerCurrency);

  try {
    const allCodes = Array.from(new Set([
      ownerCurrency,
      ...totalGroupContributionsByCurrency.map((g) => g.currency_code),
      ...members.flatMap((m) => m.contributions_by_currency.map((g) => g.currency_code)),
    ]));
    const rates = await resolveRates(allCodes);

    const totalGroupContributions = sumInCurrency(totalGroupContributionsByCurrency, ownerCurrency, rates);
    const membersWithTotals = members.map((m) => ({
      ...m,
      total_contributed: sumInCurrency(m.contributions_by_currency, ownerCurrency, rates),
    }));

    return NextResponse.json({
      ...data,
      members: membersWithTotals,
      total_group_contributions: totalGroupContributions,
      involves_currency_conversion: involvesConversion,
    });
  } catch (err) {
    // Exchange-rate lookup failed with no fallback available (see
    // lib/exchangeRates/cache.ts's documented fallback order) — fail
    // closed rather than show a wrong or partially-converted total.
    log.error("Currency normalization failed for shared goal detail", {
      user_id: user.id,
      shared_goal_id: sharedGoalId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Couldn't load contribution totals right now — try again shortly" }, { status: 503 });
  }
}
