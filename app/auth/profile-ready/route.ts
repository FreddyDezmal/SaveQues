import { createClient } from "@/lib/supabase/server";
import { NextResponse }  from "next/server";

/**
 * GET /api/auth/profile-ready
 *
 * Lightweight endpoint polled by /auth/setting-up to check whether the
 * handle_new_user trigger has finished creating the profile row.
 * Returns { ready: true } as soon as the row exists, { ready: false } otherwise.
 */
export async function GET() {
  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ready: false }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ ready: false });
  }

  return NextResponse.json({ ready: true });
}