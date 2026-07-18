"use client";

/**
 * app/(app)/achievements/AchievementsClient.tsx
 *
 * Sprint 22. Consumes GET /api/achievements (own achievements, defaults
 * to caller — get_user_achievements, 054) and POST /api/achievements/
 * visibility exactly as implemented. Achievement display info (title,
 * icon, description) comes from the existing lib/achievements.ts
 * catalog — achievement_id is a bare code with no display data in the
 * database (051's own file header notes this finding), so this is the
 * correct, existing place to resolve it, not something to duplicate.
 */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ACHIEVEMENTS } from "@/lib/achievements";
import PrivacySelector from "@/components/ui/PrivacySelector";
import type { VisibilityLevel } from "@/components/ui/VisibilityBadge";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import Skeleton from "@/components/ui/Skeleton";

interface EarnedAchievement { achievement_id: string; earned_at: string; visibility: VisibilityLevel | null; }

export default function AchievementsClient() {
  const [achievements, setAchievements] = useState<EarnedAchievement[]>([]);
  const [visibilityOverrides, setVisibilityOverrides] = useState<Record<string, VisibilityLevel>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      // Direct table read rather than GET /api/achievements: that route
      // wraps get_user_achievements() (054), a general-purpose "view
      // ANYONE's achievements" RPC that deliberately never exposes the
      // raw visibility override (only the resolved public/friends/groups/
      // private outcome would make sense for viewing someone else). For
      // managing your OWN settings you need the actual stored value —
      // user_achievements' own RLS (FOR ALL USING auth.uid()=user_id,
      // 014) already scopes a direct query to exactly that, same reuse-
      // existing-RLS pattern as the shared-goals eligible-goals fetch.
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error();
      const { data, error: queryError } = await supabase
        .from("user_achievements")
        .select("achievement_id, earned_at, visibility")
        .eq("user_id", user.id)
        .order("earned_at", { ascending: false });
      if (queryError) throw queryError;
      setAchievements((data ?? []) as EarnedAchievement[]);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function setVisibility(achievementId: string, visibility: VisibilityLevel) {
    setVisibilityOverrides((prev) => ({ ...prev, [achievementId]: visibility }));
    await fetch("/api/achievements/visibility", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ achievementId, visibility }),
    });
  }

  if (loading) return <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>;
  if (error) return <ErrorState type="server" onRetry={load} />;
  if (achievements.length === 0) {
    return <EmptyState emoji="🏆" title="No achievements yet" description="Keep saving and completing quests to unlock your first achievement." />;
  }

  return (
    <div className="space-y-3">
      {achievements.map((earned) => {
        const catalogEntry = ACHIEVEMENTS.find((a) => a.id === earned.achievement_id);
        const current = visibilityOverrides[earned.achievement_id] ?? earned.visibility ?? "friends";
        return (
          <div key={earned.achievement_id} className="card p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-11 h-11 rounded-xl bg-brand-500/10 flex items-center justify-center text-xl shrink-0" aria-hidden="true">
                {catalogEntry?.icon || "🏅"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{catalogEntry?.title || earned.achievement_id}</p>
                {catalogEntry?.description && <p className="text-xs text-white/40 truncate">{catalogEntry.description}</p>}
              </div>
            </div>
            <PrivacySelector
              kind="achievement"
              value={current}
              onChange={(v) => setVisibility(earned.achievement_id, v)}
              label="Who can see this"
            />
          </div>
        );
      })}
    </div>
  );
}
