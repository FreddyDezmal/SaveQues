import { captureServerEvent } from "@/providers/posthog-server";
import { AnalyticsEvents } from "@/lib/analytics";

export { AnalyticsEvents };

export async function trackServerEvent(
  eventName: string,
  userId: string,
  properties?: Record<string, unknown>
): Promise<void> {
  try {
    await captureServerEvent(eventName, userId, properties);
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[analytics-server] trackServerEvent error:", err);
    }
  }
}