import { NextResponse } from "next/server";
import { getBuildInfo } from "@/lib/buildInfo";

/**
 * GET /api/version
 *
 * Deliberately unauthenticated — build metadata (version, commit SHA,
 * environment) is not sensitive, and support/debugging conversations
 * ("what version are you seeing this bug on?") are exactly the case where
 * being able to check this without being logged in helps. No financial,
 * user, or credential data is exposed here.
 */
export async function GET() {
  return NextResponse.json(getBuildInfo());
}
