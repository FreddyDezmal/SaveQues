import Skeleton from "@/components/ui/Skeleton";
import { GoalCardSkeleton } from "@/components/ui/Skeleton";

export default function GoalsLoading() {
  return (
    <div className="max-w-lg mx-auto px-4 pt-6 space-y-4">
      <div className="flex items-center justify-between mb-2">
        <div className="space-y-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-3.5 w-36" />
        </div>
        <Skeleton className="h-9 w-20" />
      </div>

      <div className="space-y-3">
        <GoalCardSkeleton />
        <GoalCardSkeleton />
        <GoalCardSkeleton />
        <GoalCardSkeleton />
      </div>
    </div>
  );
}
