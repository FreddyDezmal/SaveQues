import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getEventsForUser } from "@/lib/events";
import EventsClient from "./EventsClient";

export default async function EventsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("country_code, currency_code, locale")
    .eq("id", user.id)
    .single();

  const countryCode = profile?.country_code ?? "ZA";

  // Get events relevant to this user's region
  const events = getEventsForUser(countryCode);

  // Fetch user's participation records for these events
  const slugs = events.map(e => e.id);
  const { data: participation } = await supabase
    .from("user_event_participation")
    .select("event_slug, status, completed_at, xp_earned")
    .eq("user_id", user.id)
    .in("event_slug", slugs);

  // Fetch event history (completed events, including expired ones)
  const { data: history } = await supabase
    .from("user_event_participation")
    .select("event_slug, status, completed_at, xp_earned")
    .eq("user_id", user.id)
    .eq("status", "completed")
    .order("completed_at", { ascending: false });

  const participationMap = new Map(
    (participation ?? []).map(p => [p.event_slug, p.status as "active" | "completed" | "expired"])
  );

  return (
    <EventsClient
      events={events}
      participationMap={Object.fromEntries(participationMap)}
      history={history ?? []}
      userId={user.id}
    />
  );
}
