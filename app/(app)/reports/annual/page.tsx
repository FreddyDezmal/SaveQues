/**
 * app/(app)/reports/annual/page.tsx
 * ─────────────────────────────────────────────────────────────
 * Sprint 24 — Phase 11: Export Centre — annual report view.
 *
 * Mirrors app/(app)/portfolio/page.tsx's fetch pattern (parallel
 * Promise.all, RLS via .eq("user_id", user.id)) rather than inventing a
 * new one. Calls lib/exportCenter.ts's buildAnnualReport() directly
 * (server component → lib function, same convention dashboard/page.tsx
 * uses for insights/coaching/etc.) instead of fetching its own API
 * route — no reason to pay an extra HTTP round-trip for data this
 * component can compute itself server-side.
 *
 * This page IS the "PDF export" for now — see lib/exportCenter.ts's
 * header for why there's no server-generated binary PDF yet. Printing
 * this page (AnnualReportClient's "Print / Save as PDF" button, or the
 * browser's own Ctrl/Cmd+P) produces a real PDF via the browser's
 * native print-to-PDF, styled with @media print rules in
 * AnnualReportClient.tsx.
 */

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { buildAnnualReport } from "@/lib/exportCenter";
import AnnualReportClient from "./AnnualReportClient";
import type { SavingsGoal, Transaction } from "@/lib/types";

export default async function AnnualReportPage({
  searchParams,
}: {
  searchParams: { year?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const now = new Date();
  const requestedYear = searchParams.year ? parseInt(searchParams.year, 10) : now.getUTCFullYear();
  const year = Number.isInteger(requestedYear) ? requestedYear : now.getUTCFullYear();

  const [profileRes, goalsRes, txRes] = await Promise.all([
    supabase.from("profiles").select("created_at, xp_total, currency_code, locale").eq("id", user.id).single(),
    supabase
      .from("savings_goals")
      .select("id, user_id, title, category, goal_emoji, target_amount, current_amount, target_date, is_complete, created_at")
      .eq("user_id", user.id),
    supabase
      .from("transactions")
      .select("id, user_id, goal_id, amount, note, transaction_type, created_at")
      .eq("user_id", user.id),
  ]);

  const profile = profileRes.data ?? { created_at: now.toISOString(), xp_total: 0, currency_code: "ZAR", locale: "en-ZA" };
  const goals = (goalsRes.data ?? []) as SavingsGoal[];
  const transactions = (txRes.data ?? []) as Transaction[];

  const report = buildAnnualReport({ profile, goals, transactions, year, now });
  const accountCreatedYear = new Date(profile.created_at).getUTCFullYear();

  return (
    <AnnualReportClient
      report={report}
      currencyCode={profile.currency_code ?? "ZAR"}
      locale={profile.locale ?? "en-ZA"}
      earliestYear={accountCreatedYear}
      latestYear={now.getUTCFullYear()}
    />
  );
}
