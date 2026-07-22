/**
 * lib/hooks/useExperiment.ts
 *
 * USAGE
 *   const variant = useExperiment("dashboard_layout_v2"); // string | null
 *   if (variant === "treatment") return <NewDashboard />;
 *   return <ClassicDashboard />; // null (not in the experiment) falls through to control/default
 */

import { useExperimentsContext } from "@/components/ExperimentsProvider";

/** Returns this user's assigned variant id for one experiment, or null if they're not in it (draft/not running/excluded by traffic allocation) or while loading. */
export function useExperiment(experimentKey: string): string | null {
  const { assignments } = useExperimentsContext();
  return assignments[experimentKey] ?? null;
}

export function useExperiments(): { assignments: Record<string, string>; isLoading: boolean } {
  return useExperimentsContext();
}