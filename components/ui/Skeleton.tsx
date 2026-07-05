/**
 * components/ui/Skeleton.tsx
 *
 * Sprint 15, Phase 7. app/globals.css has had a `.shimmer` utility class
 * (with its own @keyframes) since at least Sprint 12, but nothing in the
 * component tree ever used it — grep across every .tsx file turned up zero
 * matches. This is that missing piece: a small, reusable primitive so
 * future loading states reach for `<Skeleton />` instead of each screen
 * inventing its own ad-hoc pulse/opacity loading treatment.
 *
 * Deliberately not retrofitted into every existing loading state in this
 * sprint — that would cross from "polish" into "refactor every page,"
 * which the sprint brief explicitly rules out. It's introduced here so it
 * exists for the next screen that needs one, and is a small enough,
 * additive, zero-risk change to ship now rather than defer.
 */

interface SkeletonProps {
  className?: string;
  /** Renders a circular skeleton (avatars, icons) instead of a rounded rectangle. */
  circle?: boolean;
}

export default function Skeleton({ className = "", circle = false }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`shimmer ${circle ? "rounded-full" : "rounded-lg"} ${className}`}
    />
  );
}

/**
 * Common composite: a goal-card-shaped skeleton, matching the visual rhythm
 * of components/goals/GoalCard.tsx closely enough to avoid layout shift
 * when real content swaps in.
 */
export function GoalCardSkeleton() {
  return (
    <div className="card p-4 flex items-center gap-3">
      <Skeleton circle className="w-11 h-11 flex-shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-2.5 w-full" />
      </div>
    </div>
  );
}
