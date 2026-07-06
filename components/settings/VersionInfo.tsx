"use client";

/**
 * components/settings/VersionInfo.tsx
 *
 * Every field here is derived, not hardcoded:
 *   - version / commitSha / buildDate / environment  → GET /api/version,
 *     itself generated at build time (lib/buildInfo.ts + prebuild script)
 *   - PWA Status       → navigator/matchMedia standalone check, live
 *   - Service Worker    → navigator.serviceWorker.controller, live
 *   - Offline Support   → derived FROM the service worker check, not an
 *                          independent claim — if there's no active SW
 *                          controlling the page, offline support isn't
 *                          actually available for this session regardless
 *                          of what code exists, so this says so honestly
 *   - Last Updated       → localStorage timestamp set by
 *                          ServiceWorkerRegistration.tsx on this device
 */

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, HelpCircle } from "lucide-react";
import type { BuildInfo } from "@/lib/buildInfo";

type SWStatus = "active" | "registered_not_active" | "unsupported" | "checking";

function StatusRow({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-surface-border last:border-b-0">
      <span className="text-xs text-white/40">{label}</span>
      <span className="text-xs text-white/70 font-mono flex items-center gap-1.5">{icon}{value}</span>
    </div>
  );
}

export default function VersionInfo() {
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);
  const [isPWA, setIsPWA] = useState(false);
  const [swStatus, setSwStatus] = useState<SWStatus>("checking");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/version")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setBuildInfo(data))
      .catch(() => {});

    setIsPWA(
      window.matchMedia?.("(display-mode: standalone)").matches ||
        (window.navigator as any).standalone === true
    );

    if (!("serviceWorker" in navigator)) {
      setSwStatus("unsupported");
    } else {
      navigator.serviceWorker.getRegistration().then((reg) => {
        setSwStatus(reg?.active ? "active" : reg ? "registered_not_active" : "unsupported");
      });
    }

    try {
      setLastUpdated(localStorage.getItem("sq_sw_last_registered_at"));
    } catch {}
  }, []);

  const swLabel =
    swStatus === "active" ? "Active" :
    swStatus === "registered_not_active" ? "Registered (not active)" :
    swStatus === "checking" ? "Checking…" : "Unsupported";

  const offlineSupportLabel = swStatus === "active" ? "Enabled" : "Unavailable this session";

  return (
    <div>
      <p className="text-xs text-white/40 uppercase tracking-wider font-medium mb-3">Version Information</p>
      <div className="card p-4">
        <StatusRow label="Application Version" value={buildInfo ? `v${buildInfo.version}` : "…"} />
        <StatusRow label="Build Number" value={buildInfo ? buildInfo.commitSha : "…"} />
        <StatusRow
          label="Build Date"
          value={buildInfo?.buildDate ? new Date(buildInfo.buildDate).toLocaleDateString() : "Unknown (dev build)"}
        />
        <StatusRow
          label="PWA Status"
          value={isPWA ? "Installed" : "Running in browser"}
          icon={isPWA ? <CheckCircle2 size={12} className="text-emerald-400" /> : <HelpCircle size={12} className="text-white/30" />}
        />
        <StatusRow
          label="Service Worker"
          value={swLabel}
          icon={
            swStatus === "active" ? <CheckCircle2 size={12} className="text-emerald-400" /> :
            swStatus === "unsupported" ? <XCircle size={12} className="text-red-400" /> :
            <HelpCircle size={12} className="text-white/30" />
          }
        />
        <StatusRow
          label="Offline Support"
          value={offlineSupportLabel}
          icon={swStatus === "active" ? <CheckCircle2 size={12} className="text-emerald-400" /> : <XCircle size={12} className="text-amber-400" />}
        />
        <StatusRow
          label="Last Updated"
          value={lastUpdated ? new Date(lastUpdated).toLocaleString() : "Not yet registered on this device"}
        />
        <StatusRow label="Environment" value={buildInfo?.environment ?? "…"} />
      </div>
    </div>
  );
}
