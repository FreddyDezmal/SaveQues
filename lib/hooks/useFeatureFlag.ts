/**
 * lib/hooks/useFeatureFlag.ts
 *
 * Client-side access to feature flags evaluated by
 * components/FeatureFlagsProvider.tsx. That provider must be mounted
 * above whatever calls these hooks (it's wired into app/layout.tsx
 * alongside AnalyticsProvider) — if it isn't, these hooks safely
 * default to `false` / `{}` rather than throwing, same fail-closed
 * behaviour as the rest of this system.
 *
 * USAGE
 *   const aiCoachEnabled = useFeatureFlag("ai_coach");
 *   if (aiCoachEnabled) return <AICoachPanel />;
 *
 *   // Reading several flags without re-subscribing per flag:
 *   const flags = useFeatureFlags();
 */

import { useFeatureFlagsContext } from "@/components/FeatureFlagsProvider";

/** Returns whether a single flag is enabled for the current user. Defaults to false while loading. */
export function useFeatureFlag(flagKey: string): boolean {
  const { flags } = useFeatureFlagsContext();
  return flags[flagKey] ?? false;
}

/** Returns the full evaluated flags map plus loading state, for components that check several flags. */
export function useFeatureFlags(): { flags: Record<string, boolean>; isLoading: boolean } {
  return useFeatureFlagsContext();
}