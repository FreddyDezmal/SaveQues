/**
 * app/api/leaderboards/consistency/route.ts
 *
 * ?scope=friends|group (default friends), ?groupId=... (required if group)
 *
 * Unlike the other leaderboard routes, this one does real work: the score
 * itself is NOT computed in SQL (052's file header explains why — reusing
 * lib/analyticsEngine.ts's documented consistencyScore() instead of a
 * second, potentially-drifting implementation). This route fetches raw
 * deposit timestamps per member via leaderboard_consistency_inputs()
 * (which never selects amount at all), runs each member's dates through
 * the existing formula, and ranks the results here.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { consistencyScore, type Deposit } from "@/lib/analyticsEngine";

const log = createLogger("leaderboards.consistency");

interface ConsistencyInputRow {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_emoji: string | null;
  deposit_dates: string[] | null;
}

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const scope = req.nextUrl.searchParams.get("scope") === "group" ? "group" : "friends";
  const groupId = req.nextUrl.searchParams.get("groupId");

  if (scope === "group" && !groupId) {
    return NextResponse.json({ error: "groupId required when scope=group" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("leaderboard_consistency_inputs", {
    p_scope: scope,
    p_group_id: scope === "group" ? groupId : null,
  });

  if (error) {
    log.error("leaderboard_consistency_inputs RPC failed", { user_id: user.id, scope, groupId, error: error.message });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  const rows = (data ?? []) as ConsistencyInputRow[];

  const scored = rows.map((row) => {
    // consistencyScore() only ever reads .created_at (verified against
    // lib/analyticsEngine.ts) — this stub deliberately carries no amount,
    // not even a placeholder one, since the DB layer never sent one.
    const stubDeposits = (row.deposit_dates ?? []).map((created_at) => ({ created_at })) as unknown as Deposit[];
    return {
      user_id: row.user_id,
      username: row.username,
      display_name: row.display_name,
      avatar_emoji: row.avatar_emoji,
      deposit_count: stubDeposits.length,
      consistency_score: consistencyScore(stubDeposits), // null if fewer than 3 deposits
    };
  });

  // Members with too little history to score (null) sort last, not first.
  scored.sort((a, b) => (b.consistency_score ?? -1) - (a.consistency_score ?? -1));

  let rank = 0;
  let lastScore: number | null | undefined = undefined;
  const ranked = scored.map((entry, i) => {
    if (entry.consistency_score !== lastScore) {
      rank = i + 1;
      lastScore = entry.consistency_score;
    }
    return { ...entry, rank: entry.consistency_score === null ? null : rank };
  });

  return NextResponse.json({ scope, entries: ranked });
}