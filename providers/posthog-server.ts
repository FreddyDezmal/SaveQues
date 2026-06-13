/**
 * providers/posthog-server.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * PostHog Node.js SDK for use in Next.js API routes and Server Components.
 *
 * IMPORTANT: This file uses the posthog-node package (not posthog-js).
 * It is the only place in the codebase that imports posthog-node.
 *
 * SETUP
 *  1. pnpm add posthog-node
 *  2. Set POSTHOG_KEY in .env.local (server-only, not NEXT_PUBLIC_)
 *
 * USAGE (in API routes)
 *   import { captureServerEvent } from "@/providers/posthog-server";
 *   await captureServerEvent("deposit_made", userId, { amount: 500 });
 *
 * Or use the abstraction:
 *   import { trackServerEvent } from "@/lib/analytics";
 *   await trackServerEvent("deposit_made", userId, { amount: 500 });
 */

// ── Lazy singleton ────────────────────────────────────────────────────────────

let _client: any = null;

function getPostHogNode(): any | null {
  const key = process.env.POSTHOG_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[posthog-server] POSTHOG_KEY is not set — server-side analytics disabled.");
    }
    return null;
  }

  if (!_client) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PostHog } = require("posthog-node");
    _client = new PostHog(key, {
      host:          process.env.POSTHOG_HOST ?? "https://app.posthog.com",
      flushAt:       1,   // Flush after every event in serverless context
      flushInterval: 0,   // Don't hold events — flush immediately
    });
  }

  return _client;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Capture an event from a server-side context (API route, Server Component).
 * Automatically shuts down the client to flush the event before the
 * serverless function exits.
 */
export async function captureServerEvent(
  eventName: string,
  userId: string,
  properties?: Record<string, unknown>
): Promise<void> {
  try {
    const client = getPostHogNode();
    if (!client) return;

    client.capture({
      distinctId: userId,
      event:      eventName,
      properties: {
        $lib: "posthog-node",
        ...(properties ?? {}),
      },
    });

    // Flush synchronously — critical for serverless functions
    await client.shutdownAsync();
    // Reset so next call gets a fresh client
    _client = null;
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[posthog-server] captureServerEvent error:", err);
    }
  }
}

/**
 * Identify a user from server-side code.
 * Call after signup to set user traits in PostHog.
 */
export async function identifyServerUser(
  userId: string,
  traits?: Record<string, unknown>
): Promise<void> {
  try {
    const client = getPostHogNode();
    if (!client) return;

    client.identify({
      distinctId: userId,
      properties: traits ?? {},
    });

    await client.shutdownAsync();
    _client = null;
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[posthog-server] identifyServerUser error:", err);
    }
  }
}
