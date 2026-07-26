import { Suspense } from "react";
import AchievementsClient from "./AchievementsClient";

export default function AchievementsPage() {
  return (
    <div className="max-w-lg mx-auto px-4 pt-6">
      <h1 className="font-display text-2xl font-bold text-white mb-1">Achievements</h1>
      <p className="text-sm text-white/40 mb-5">Control who can see each achievement you&apos;ve earned.</p>
      {/* Suspense boundary required by Next.js for useSearchParams()
          (Sprint 27, Phase 6 — AchievementsClient now reads ?highlight=) */}
      <Suspense fallback={null}>
        <AchievementsClient />
      </Suspense>
    </div>
  );
}
