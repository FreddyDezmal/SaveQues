/**
 * app/(app)/notifications/page.tsx
 * ─────────────────────────────────────────────────────────────
 * Sprint 27 — Phase 2: the "full inbox" the compact bell-dropdown panel
 * (components/notifications/NotificationCenter.tsx) links to via its new
 * "View all notifications" footer. Same relationship as
 * app/(app)/reports/annual/page.tsx to a dashboard card — a compact
 * always-available surface plus a dedicated page for the fuller
 * experience, not a redesign of the panel itself.
 *
 * Auth check only — all real data fetching happens client-side in
 * NotificationsInboxClient via the same /api/notifications/list route
 * the panel uses (tabs/filters change query params, not a server
 * re-render), consistent with how the panel itself already works.
 */

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import NotificationsInboxClient from "./NotificationsInboxClient";

export default async function NotificationsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  return <NotificationsInboxClient />;
}