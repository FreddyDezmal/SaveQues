import Skeleton from "@/components/ui/Skeleton";
import { GoalCardSkeleton } from "@/components/ui/Skeleton";

/**
 * app/(app)/dashboard/loading.tsx
 *
 * Sprint 16, Phase 7. Next.js's App Router automatically wraps the route
 * segment in a Suspense boundary and renders this file while the server
 * component (app/(app)/dashboard/page.tsx) awaits its Supabase queries —
 * zero client-side plumbing needed, this is a framework convention that
 * simply wasn't used anywhere in the app before this sprint. Shaped
 * roughly like the real dashboard (header + a few card-shaped blocks) so
 * the transition to real content doesn't visibly jump.
 */
export default function DashboardLoading() {
  return (
    <div className="max-w-lg mx-auto px-4 pt-6 space-y-4">
      <div className="flex items-center justify-between mb-2">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-3.5 w-28" />
        </div>
        <Skeleton circle className="w-11 h-11" />
      </div>

      <Skeleton className="h-24 w-full" />

      <div className="space-y-3">
        <GoalCardSkeleton />
        <GoalCardSkeleton />
        <GoalCardSkeleton />
      </div>
    </div>
  );
}
