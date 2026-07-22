/**
 * app/api/admin/dev-console/impersonate/route.ts
 *
 * Generates a real Supabase magic-link sign-in URL for a demo account,
 * so an admin can browse the app AS that demo user — for QA on
 * user-specific UI states (a specific momentum level, a specific
 * season progress, a specific notification state) without manually
 * reproducing that state in their own account.
 *
 * READ THIS BEFORE CHANGING requireDemoAccount() OR THIS ROUTE:
 *   This is genuinely real authentication — opening the returned link
 *   logs the admin's browser in AS the target account, indistinguishable
 *   from that account's own login, for as long as that session lasts.
 *   The Sprint 24 brief asks for "Impersonate demo users" — not
 *   "impersonate any user" — and requireDemoAccount() (lib/devConsole.ts)
 *   is what turns that word choice into an actual enforced boundary
 *   instead of a naming convention. If is_demo is ever wrongly set true
 *   on a real user's account (see migration 060's column comment:
 *   "Never set true on a real user account"), this route would generate
 *   a working login link for that real person's real financial account.
 *   The gate lives entirely in that one is_demo check — there's no
 *   secondary safeguard in this route, which is exactly why the audit
 *   log entry below records every single impersonation, unconditionally.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, auditLog } from "@/lib/adminAudit";
import { requireDemoAccount }     from "@/lib/devConsole";

export async function POST(req: NextRequest) {
  try {
    const { user, service } = await requireAdmin(req, "admin.dev-console.impersonate");
    const { userId } = await req.json();

    await requireDemoAccount(service, userId);

    const { data: authUser, error: authUserError } = await service.auth.admin.getUserById(userId);
    if (authUserError || !authUser?.user?.email) {
      return NextResponse.json({ error: "Couldn't look up that demo account's login email." }, { status: 500 });
    }

    const { data: link, error: linkError } = await service.auth.admin.generateLink({
      type: "magiclink",
      email: authUser.user.email,
    });
    if (linkError || !link?.properties?.action_link) {
      return NextResponse.json({ error: linkError?.message ?? "Couldn't generate a sign-in link." }, { status: 500 });
    }

    // Unconditional, not best-effort — this is the one place in the dev
    // console where the audit trail matters more than the action
    // succeeding cleanly. If this write fails, that failure should be
    // visible rather than swallowed the way a normal auditLog() call
    // being "best effort" might otherwise treat it.
    await auditLog(service, user.id, "CREATE", "dev_console_action", `impersonate:${userId}`,
      null, { action: "impersonate", target_user_id: userId, target_email: authUser.user.email }
    );

    return NextResponse.json({ success: true, signInLink: link.properties.action_link });
  } catch (res) { return res as Response; }
}