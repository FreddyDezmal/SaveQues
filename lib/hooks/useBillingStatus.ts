"use client";

/**
 * lib/hooks/useBillingStatus.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 29 — Premium Subscription Platform. Every premium UI component
 * (PremiumBadge, LockedCard, UpgradePrompt, plan comparison dialog) reads
 * entitlements through this one hook rather than each fetching
 * /api/billing/status itself — same "one central service" rule the
 * server-side lib/billing/entitlements.ts follows, mirrored on the
 * client. A single in-memory cache (module-level, reset on reload) means
 * mounting five gated cards on one dashboard costs one network request,
 * not five.
 */

import { useEffect, useState, useCallback } from "react";
import type { Entitlements } from "@/lib/billing/types";

export interface BillingStatusUsage {
  allowed: boolean;
  used: number;
  limit: number | null;
  remaining: number | null;
}

export interface BillingStatus {
  entitlements: Entitlements;
  usage: Record<string, BillingStatusUsage>;
  subscription: {
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    hasBillingAccount: boolean;
  } | null;
  plans: Array<{ id: string; name: string; priceCents: number | null; interval: string }>;
}

let cached: BillingStatus | null = null;
let inflight: Promise<BillingStatus | null> | null = null;

async function fetchStatus(): Promise<BillingStatus | null> {
  try {
    const res = await fetch("/api/billing/status");
    if (!res.ok) return null;
    const data = (await res.json()) as BillingStatus;
    cached = data;
    return data;
  } catch {
    return null;
  }
}

export function invalidateBillingStatus(): void {
  cached = null;
  inflight = null;
}

/**
 * Returns { status, loading, isPremium, refresh }. `isPremium` defaults
 * to false while loading — every gated UI element should render its
 * FREE-tier appearance first and only unlock once entitlements confirm
 * premium, never the reverse (fail toward showing the lock, not toward
 * briefly flashing unlocked content).
 */
export function useBillingStatus() {
  const [status, setStatus] = useState<BillingStatus | null>(cached);
  const [loading, setLoading] = useState(!cached);

  const refresh = useCallback(async () => {
    invalidateBillingStatus();
    setLoading(true);
    const data = await fetchStatus();
    setStatus(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (cached) {
      setStatus(cached);
      setLoading(false);
      return;
    }
    let cancelled = false;
    if (!inflight) inflight = fetchStatus();
    inflight.then((data) => {
      if (!cancelled) {
        setStatus(data);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    status,
    loading,
    isPremium: status?.entitlements.isPremium ?? false,
    refresh,
  };
}
