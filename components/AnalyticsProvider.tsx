"use client";

import { useEffect } from "react";
import { initPostHog, identifyPostHogUser } from "@/providers/posthog";

interface Props {
  children?: React.ReactNode;
  userId?: string;
  traits?: Record<string, unknown>;
}

export default function AnalyticsProvider({ children, userId, traits }: Props) {
  useEffect(() => {
    initPostHog().then(() => {
      if (userId) {
        // Call identifyPostHogUser directly — bypasses the lib/analytics.ts
        // singleton which can reset to null on module re-evaluation in
        // Next.js App Router, causing silent no-ops.
        identifyPostHogUser(userId, traits);
      }
    });
  }, [userId]);

  return <>{children}</>;
}
