/**
 * app/api/debug/sentry-test/route.ts
 *
 * Hit GET /api/debug/sentry-test to verify Sentry is receiving exceptions.
 * Blocked in production — returns 404.
 */

import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const error = new Error(
    `[SaveQuest Sentry test] This is a manually triggered test exception — ${new Date().toISOString()}`
  );

  // Explicitly capture and flush before responding so the event
  // reaches Sentry even if the process doesn't stay alive long enough
  Sentry.captureException(error);
  await Sentry.flush(2000);

  return NextResponse.json(
    { error: error.message, sentry: "event captured and flushed" },
    { status: 500 }
  );
}