/**
 * providers/posthog.ts
 * Client-side PostHog — single source of truth.
 * posthog-js is imported once here; everything calls through this module.
 */

import posthog from "posthog-js";
import { registerProvider } from "@/lib/analytics";
import type { AnalyticsProvider } from "@/lib/analytics";

let _initialised = false;

export function initPostHog(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (_initialised) return Promise.resolve();

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[posthog] NEXT_PUBLIC_POSTHOG_KEY is not set.");
    }
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    posthog.init(key, {
      api_host:                  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
      autocapture:               false,
      capture_pageview:          false,
      disable_session_recording: true,
      batch_size:                20,
      request_timeout:           3000,
      loaded(ph) {
        _initialised = true;

        const provider: AnalyticsProvider = {
          identify(userId, traits) { ph.identify(userId, traits ?? {}); },
          capture(eventName, properties) { ph.capture(eventName, properties ?? {}); },
          async flush() {},
        };

        registerProvider(provider);

        if (process.env.NODE_ENV === "development") {
          (window as any).__ph = ph;
          ph.debug();
        }

        resolve();
      },
    });
  });
}

/**
 * Identify the current user directly via posthog-js.
 * Bypasses the analytics abstraction singleton to avoid module re-evaluation
 * issues in Next.js App Router where _provider can reset to null.
 */
export function identifyPostHogUser(userId: string, traits?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  if (!_initialised) return;
  posthog.identify(userId, traits ?? {});

  if (process.env.NODE_ENV === "development") {
    console.log("[posthog] identify →", userId, "distinct_id is now:", posthog.get_distinct_id());
  }
}
