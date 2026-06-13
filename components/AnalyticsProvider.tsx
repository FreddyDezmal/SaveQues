"use client";

/**
 * components/AnalyticsProvider.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Client component that initialises the PostHog analytics provider once
 * the app mounts in the browser.
 *
 * Place this inside your root layout (app/layout.tsx) as a sibling to
 * the main content — it renders nothing visible.
 *
 * <AnalyticsProvider>
 *   {children}
 * </AnalyticsProvider>
 */

import { useEffect } from "react";
import { initPostHog } from "@/providers/posthog";

interface Props {
  children?: React.ReactNode;
}

export default function AnalyticsProvider({ children }: Props) {
  useEffect(() => {
    // Initialise PostHog exactly once when the app mounts.
    // Subsequent re-renders are no-ops because posthog-js guards
    // against double-initialisation internally.
    initPostHog();
  }, []);

  return <>{children}</>;
}
