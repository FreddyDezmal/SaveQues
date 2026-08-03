"use client";

/**
 * lib/hooks/useGatedDownload.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 30 — Phase 9: Upgrade Experience.
 *
 * AUDIT FINDING: every CSV export in the app (transactions, goals, and
 * the annual report's monthly/category/milestones breakdowns, all in
 * app/(app)/reports/annual/AnnualReportClient.tsx) was a plain `<a
 * href="/api/export/...">` link. app/api/export/*'s exports_limit gate
 * (5/month free) has worked correctly since Sprint 29 — but a free user
 * who exhausts it and clicks one of these links gets navigated away from
 * the app entirely to a raw JSON error page:
 * `{"error":"You've reached...","code":"PLAN_LIMIT_REACHED",...}`. That
 * satisfies none of Phase 9's four requirements (preview, explanation,
 * benefits, CTA) — it's not a locked feature shown tastefully, it's a
 * broken-looking page. This hook replaces the bare link with a fetch
 * that keeps the user in the app and shows components/billing/UpgradePrompt
 * with the server's real message when blocked.
 *
 * Every export route already returns the same shape on block (see
 * lib/billing/gate.ts's enforceUsageLimit: `{ error, code:
 * "PLAN_LIMIT_REACHED", limit, used }`) and a CSV blob on success — this
 * hook doesn't reimplement that contract, just consumes it safely.
 */

import { useCallback, useState } from "react";

interface GatedDownloadBlocked {
  message: string;
  limit: number | null;
  used: number | null;
}

export function useGatedDownload() {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<GatedDownloadBlocked | null>(null);

  const download = useCallback(async (url: string, filename: string) => {
    setBlocked(null);
    setDownloading(url);
    try {
      const res = await fetch(url);

      if (res.status === 403) {
        const body = await res.json().catch(() => null);
        setBlocked({
          message: body?.error ?? "You've reached your plan's export limit for this period. Upgrade to Premium for unlimited access.",
          limit: body?.limit ?? null,
          used: body?.used ?? null,
        });
        return;
      }

      if (!res.ok) {
        setBlocked({ message: "Couldn't generate that export right now — try again in a moment.", limit: null, used: null });
        return;
      }

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setBlocked({ message: "Couldn't generate that export right now — check your connection and try again.", limit: null, used: null });
    } finally {
      setDownloading(null);
    }
  }, []);

  return { download, downloading, blocked, clearBlocked: () => setBlocked(null) };
}
