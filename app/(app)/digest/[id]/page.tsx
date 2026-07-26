import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import DigestClient from "./DigestClient";

/**
 * app/(app)/digest/[id]/page.tsx
 * Sprint 27, Phase 5. Same shape as app/(app)/goals/[id]/page.tsx: server
 * component does the auth check and the data fetch directly (no separate
 * API route — this app's existing convention for a single-record detail
 * page), client component does the rendering.
 *
 * The explicit .eq("user_id", user.id) below is defense-in-depth on top
 * of user_digests' own RLS policy (20260724_user_digests.sql) — belt and
 * suspenders, matching how the goal detail page already does it for
 * savings_goals.
 */
export default async function DigestPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [{ data: digest }, { data: profile }] = await Promise.all([
    supabase.from("user_digests").select("*").eq("id", params.id).eq("user_id", user.id).single(),
    supabase.from("profiles").select("currency_code, locale").eq("id", user.id).single(),
  ]);

  if (!digest) notFound();

  return (
    <DigestClient
      digestType={digest.digest_type}
      periodStart={digest.period_start}
      periodEnd={digest.period_end}
      payload={digest.payload}
      currencyCode={profile?.currency_code ?? "ZAR"}
      locale={profile?.locale ?? "en-ZA"}
    />
  );
}
