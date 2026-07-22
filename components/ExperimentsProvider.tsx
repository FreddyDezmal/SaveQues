"use client";

import { createContext, useContext, useEffect, useState } from "react";

interface ExperimentsContextValue {
  /** { [experimentKey]: variantId }. Empty until the first fetch resolves, or if the user has no active assignments. */
  assignments: Record<string, string>;
  isLoading: boolean;
}

const ExperimentsContext = createContext<ExperimentsContextValue>({ assignments: {}, isLoading: true });

interface Props {
  children?: React.ReactNode;
  /** Re-fetches on change — see FeatureFlagsProvider.tsx's identical `userId` prop for why. */
  userId?: string;
}

/**
 * Fetches this user's experiment assignments once on mount from
 * GET /api/experiments. Never throws — mirrors FeatureFlagsProvider.tsx.
 * Only fetches when userId is present (an anonymous visitor has no
 * assignment to fetch — see app/api/experiments/route.ts).
 */
export default function ExperimentsProvider({ children, userId }: Props) {
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setAssignments({});
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    fetch("/api/experiments")
      .then((res) => (res.ok ? res.json() : { assignments: {} }))
      .then((data) => { if (!cancelled) setAssignments(data.assignments ?? {}); })
      .catch(() => { if (!cancelled) setAssignments({}); })
      .finally(() => { if (!cancelled) setIsLoading(false); });

    return () => { cancelled = true; };
  }, [userId]);

  return <ExperimentsContext.Provider value={{ assignments, isLoading }}>{children}</ExperimentsContext.Provider>;
}

export function useExperimentsContext(): ExperimentsContextValue {
  return useContext(ExperimentsContext);
}
