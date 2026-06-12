import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getEventsForUser, getEventWindow, isEventVisibleForRegion, sortEventsForDisplay } from "@/lib/events";
import type { SaveQuestEvent } from "@/lib/events";
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

  // Static events from lib/events.ts
  const staticEvents = getEventsForUser(countryCode);

  // DB events created via admin — fetch with their regions
  const { data: dbEventRows } = await supabase
    .from("events")
    .select("*, event_regions(region)")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  // Convert DB rows to SaveQuestEvent shape and compute their window
  const now = new Date();
  const dbEvents = (dbEventRows ?? [])
    .map((row: any) => {
      const regions = (row.event_regions ?? []).map((r: any) => r.region);
      const event: SaveQuestEvent = {
        id:              row.slug,
        title:           row.title,
        description:     row.description,
        emoji:           row.emoji,
        event_type:      row.event_type,
        xp_reward:       row.xp_reward,
        available_from:  row.available_from ?? null,
        available_until: row.available_until ?? null,
        regions:         regions.length > 0 ? regions : ["GLOBAL"],
        is_active:       row.is_active,
        is_annual:       row.is_annual,
        preview_days:    row.preview_days ?? 5,
      };
      return { ...event, window: getEventWindow(event, now) };
    })
    .filter((e: any) =>
      isEventVisibleForRegion(e.regions, countryCode) &&
      (e.window.status === "active" ||
        (e.window.status === "upcoming" && (e.window.startsInDays ?? 999) <= e.preview_days))
    );

  // Merge: DB events take precedence over static events with the same slug
  const staticIds = new Set(dbEvents.map((e: any) => e.id));
  const filteredStatic = staticEvents.filter(e => !staticIds.has(e.id));
  const events = sortEventsForDisplay([...dbEvents, ...filteredStatic]);

  // Fetch participation for all visible events
  const allSlugs = events.map(e => e.id);
  const [participationRes, historyRes] = await Promise.all([
    allSlugs.length > 0
      ? supabase.from("user_event_participation").select("event_slug, status, completed_at, xp_earned").eq("user_id", user.id).in("event_slug", allSlugs)
      : Promise.resolve({ data: [] }),
    supabase.from("user_event_participation").select("event_slug, status, completed_at, xp_earned").eq("user_id", user.id).eq("status", "completed").order("completed_at", { ascending: false }),
  ]);

  const participationMap = new Map(
    ((participationRes as any).data ?? []).map((p: any) => [p.event_slug, p.status as "active" | "completed" | "expired"])
  );

  return (
    <EventsClient
      events={events}
      participationMap={Object.fromEntries(participationMap)}
      history={(historyRes as any).data ?? []}
      userId={user.id}
    />
  );
}