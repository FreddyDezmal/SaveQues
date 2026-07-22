"use client";

import { createContext, useContext, useEffect, useState } from "react";

interface FeatureFlagsContextValue {
  /** { [flagKey]: boolean }. Empty until the first fetch resolves. */
  flags: Record<string, boolean>;
  /** True until the initial fetch has resolved (success or failure). */
  isLoading: boolean;
}

const FeatureFlagsContext = createContext<FeatureFlagsContextValue>({
  flags: {},
  isLoading: true,
});

interface Props {
  children?: React.ReactNode;
  /**
   * Included so the provider re-fetches if the logged-in user changes
   * (e.g. sign-out/sign-in in the same tab) — overrides and rollout
   * bucketing are per-user, so a stale flags object could otherwise
   * leak the previous user's evaluation.
   */
  userId?: string;
}

/**
 * Fetches this user's evaluated feature flags once on mount (and again
 * if userId changes) from GET /api/feature-flags. Never throws — a
 * failed fetch just leaves every flag defaulting to `false` via
 * useFeatureFlag(), matching the "flags must never break the page"
 * philosophy in lib/featureFlags.ts.
 */
export default function FeatureFlagsProvider({ children, userId }: Props) {
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    setIsLoading(true);
    fetch("/api/feature-flags")
      .then((res) => (res.ok ? res.json() : { flags: {} }))
      .then((data) => {
        if (!cancelled) setFlags(data.flags ?? {});
      })
      .catch(() => {
        if (!cancelled) setFlags({});
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [userId]);

  return (
    <FeatureFlagsContext.Provider value={{ flags, isLoading }}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

export function useFeatureFlagsContext(): FeatureFlagsContextValue {
  return useContext(FeatureFlagsContext);
}