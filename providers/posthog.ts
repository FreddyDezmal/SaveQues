/**
 * providers/posthog.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * PostHog implementation of the AnalyticsProvider interface.
 *
 * This is the ONLY file in the codebase that imports posthog-js.
 * Application code must always go through lib/analytics.ts.
 *
 * SETUP
 *  1. pnpm add posthog-js
 *  2. Set NEXT_PUBLIC_POSTHOG_KEY in .env.local
 *  3. Call initPostHog() from your root layout (client component).
 *
 * PRIVACY
 *  • autocapture disabled — we control exactly what's tracked.
 *  • session_recording disabled by default.
 *  • No personal data in event properties; userId is a UUID.
 */

import type { AnalyticsProvider } from "@/lib/analytics";

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Creates and initialises a PostHog analytics provider.
 * Returns null if the API key is missing (e.g., in CI / test environments).
 */
export function createPostHogProvider(): AnalyticsProvider | null {
  if (typeof window === "undefined") {
    // Server-side: use posthog-server.ts instead
    return null;
  }

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[posthog] NEXT_PUBLIC_POSTHOG_KEY is not set — analytics disabled.");
    }
    return null;
  }

  // Lazy-import so posthog-js is only bundled when the key exists
  // We use a synchronous require here because this runs client-side only
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const posthog = require("posthog-js").default;

  posthog.init(key, {
    api_host:             process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://app.posthog.com",
    // Privacy defaults
    autocapture:          false,   // No automatic click/form tracking
    capture_pageview:     false,   // We track page views manually if needed
    disable_session_recording: true,
    // Performance
    batch_size:           20,
    request_timeout:      3000,
    loaded(ph: any) {
      if (process.env.NODE_ENV === "development") {
        // Log to console in dev so you can see events without PostHog dashboard
        ph.debug();
      }
    },
  });

  return {
    identify(userId: string, traits?: Record<string, unknown>): void {
      posthog.identify(userId, traits ?? {});
    },

    capture(eventName: string, properties?: Record<string, unknown>): void {
      posthog.capture(eventName, properties ?? {});
    },

    async flush(): Promise<void> {
      // posthog-js flushes automatically; no-op here
    },
  };
}

/**
 * Convenience: initialise PostHog and register with the analytics layer.
 * Import and call this once from your root Client Layout.
 *
 * Example:
 *   "use client";
 *   import { initPostHog } from "@/providers/posthog";
 *   initPostHog();   // call at module level or in useEffect
 */
export function initPostHog(): void {
  const { registerProvider } = require("@/lib/analytics");
  const provider = createPostHogProvider();
  if (provider) {
    registerProvider(provider);
  }
}
