/**
 * app/api/invitations/create/route.ts
 *
 * Creates an invite and always returns a working shareable link, whether
 * or not email delivery is configured (it isn't — see lib/invites.ts).
 * A group-context invite is only accepted if the caller is that group's
 * owner/admin — enforced at the DB level (enforce_invite_permissions,
 * 053), verified here just to return a clean 400 instead of a raw
 * trigger exception.
 *
 * NEXT_PUBLIC_APP_URL is assumed as the base URL for the invite link.
 * No such env var convention existed elsewhere in this codebase (only
 * NEXT_PUBLIC_SUPABASE_URL does) — if it isn't set, this falls back to a
 * relative path, which still works for in-app sharing but won't be a
 * complete absolute URL for, say, a QR code rendered outside the app.
 */

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { checkAttemptRateLimit, recordAttempt } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";
import { generateInviteToken, buildInviteUrl, sendInviteEmail } from "@/lib/invites";

const log = createLogger("invitations.create");
const RATE_LIMIT_ENDPOINT = "invitations.create";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const inviteType = body.inviteType === "email" ? "email" : "link";
  const groupId = typeof body.groupId === "string" ? body.groupId : null;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : null;

  if (inviteType === "email" && (!email || !EMAIL_RE.test(email))) {
    return NextResponse.json({ error: "A valid email is required for invite_type=email" }, { status: 400 });
  }

  const limit = await checkAttemptRateLimit(supabase, {
    userId: user.id,
    endpoint: RATE_LIMIT_ENDPOINT,
    windowMinutes: 60,
    maxRequests: 20,
    actionLabel: "invitations created",
  });
  await recordAttempt(supabase, user.id, RATE_LIMIT_ENDPOINT);
  if (!limit.allowed) {
    return NextResponse.json({ error: limit.message }, { status: 429 });
  }

  const token = generateInviteToken();

  const { data: invite, error } = await supabase
    .from("invitations")
    .insert({
      inviter_id: user.id,
      invite_type: inviteType,
      email: inviteType === "email" ? email : null,
      token,
      context_type: groupId ? "group" : "general",
      group_id: groupId,
      status: inviteType === "email" ? "pending" : "sent", // link-type is "sent" immediately (there's nothing to send)
    })
    .select("id, token, invite_type, context_type, group_id, expires_at, created_at")
    .single();

  if (error) {
    log.warn("invite create failed", { user_id: user.id, groupId, error: error.message });
    return NextResponse.json(
      { error: "Couldn't create that invite — if this was a group invite, check you're the owner or an admin" },
      { status: 400 }
    );
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  const inviteUrl = buildInviteUrl(baseUrl, token);

  let emailResult: { sent: boolean; reason?: string } | null = null;
  if (inviteType === "email" && email) {
    const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", user.id).single();
    let groupName: string | null = null;
    if (groupId) {
      const { data: group } = await supabase.from("groups").select("name").eq("id", groupId).maybeSingle();
      groupName = group?.name ?? null;
    }
    emailResult = await sendInviteEmail({
      toEmail: email,
      inviterDisplayName: profile?.display_name || "A SaveQuest user",
      inviteUrl,
      groupName,
    });
  }

  return NextResponse.json({ success: true, invite, inviteUrl, email: emailResult });
}