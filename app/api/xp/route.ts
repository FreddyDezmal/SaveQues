/**
 * app/api/xp/route.ts
 * ─────────────────────────────────────────────────────────────
 * SECURITY HARDENED — this endpoint is intentionally disabled.
 *
 * The old generic /api/xp accepted any XPAction from the client and
 * immediately awarded XP with zero idempotency — a critical replay vector.
 *
 * XP is now awarded through dedicated action-specific routes only:
 *   POST /api/quest/daily/complete
 *   POST /api/quest/weekly/complete
 *   POST /api/quest/challenge/complete
 *   POST /api/quest/chain/step
 *   POST /api/events/complete
 *   POST /api/transactions  (log_saving / goal_complete)
 *
 * Returning 410 Gone so cached client references get a clear signal.
 */

import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "This endpoint has been deprecated for security reasons.",
      replacement: [
        "POST /api/quest/daily/complete",
        "POST /api/quest/weekly/complete",
        "POST /api/quest/challenge/complete",
        "POST /api/quest/chain/step",
        "POST /api/events/complete",
        "POST /api/transactions",
      ],
    },
    { status: 410 }
  );
}
