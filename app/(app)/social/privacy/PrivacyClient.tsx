"use client";

/**
 * app/(app)/social/privacy/PrivacyClient.tsx
 *
 * Sprint 22. Reads current values via a direct profiles query (RLS
 * auth.uid() = id, 014, already scopes this to self) and saves via
 * PATCH /api/profile exactly as implemented — that route was extended
 * in Phase 12 specifically to accept profile_visibility/
 * activity_visibility, validated against the same CHECK constraints as
 * the database (045).
 */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PrivacySelector from "@/components/ui/PrivacySelector";
import type { VisibilityLevel } from "@/components/ui/VisibilityBadge";
import ErrorState from "@/components/ui/ErrorState";
import Skeleton from "@/components/ui/Skeleton";

export default function PrivacyClient() {
  const [profileVisibility, setProfileVisibility] = useState<VisibilityLevel>("friends");
  const [activityVisibility, setActivityVisibility] = useState<VisibilityLevel>("friends");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error();
      const { data, error: queryError } = await supabase
        .from("profiles")
        .select("profile_visibility, activity_visibility")
        .eq("id", user.id)
        .single();
      if (queryError || !data) throw new Error();
      setProfileVisibility(data.profile_visibility);
      setActivityVisibility(data.activity_visibility);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save(field: "profile_visibility" | "activity_visibility", value: VisibilityLevel) {
    if (field === "profile_visibility") setProfileVisibility(value);
    else setActivityVisibility(value);
    setSaved(false);
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  if (loading) return <Skeleton className="h-64 rounded-2xl" />;
  if (error) return <ErrorState type="server" onRetry={load} />;

  return (
    <div className="card p-5 space-y-6">
      <PrivacySelector
        kind="profile"
        value={profileVisibility}
        onChange={(v) => save("profile_visibility", v)}
        label="Who can find your profile"
      />
      <PrivacySelector
        kind="activity"
        value={activityVisibility}
        onChange={(v) => save("activity_visibility", v)}
        label="Default visibility for achievements and activity"
      />
      <div role="status" className="text-xs text-emerald-400 h-4">{saved && "Saved"}</div>
    </div>
  );
}
