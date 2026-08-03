/**
 * tests/component/useFeatureEntitlement.test.tsx
 * Sprint 30 — Phase 12/13: Security audit — de-duplicated entitlement check.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const mockUseBillingStatus = vi.fn();
vi.mock("@/lib/hooks/useBillingStatus", () => ({
  useBillingStatus: () => mockUseBillingStatus(),
}));

import { useFeatureEntitlement } from "@/lib/hooks/useFeatureEntitlement";

describe("useFeatureEntitlement", () => {
  beforeEach(() => {
    mockUseBillingStatus.mockReset();
  });

  it("is not entitled for a free user", () => {
    mockUseBillingStatus.mockReturnValue({ status: null, loading: false, isPremium: false });
    const { result } = renderHook(() => useFeatureEntitlement("ai_coaching"));
    expect(result.current.entitled).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it("is entitled when the specific feature key is enabled for a premium user", () => {
    mockUseBillingStatus.mockReturnValue({
      status: { entitlements: { features: { ai_coaching: { enabled: true, limit: null } } } },
      loading: false,
      isPremium: true,
    });
    const { result } = renderHook(() => useFeatureEntitlement("ai_coaching"));
    expect(result.current.entitled).toBe(true);
  });

  it("is not entitled if isPremium is true but the specific feature key is missing from the catalogue", () => {
    mockUseBillingStatus.mockReturnValue({
      status: { entitlements: { features: {} } },
      loading: false,
      isPremium: true,
    });
    const { result } = renderHook(() => useFeatureEntitlement("ai_coaching"));
    expect(result.current.entitled).toBe(false);
  });

  it("is not entitled if the feature key is enabled but isPremium is false (defense in depth against a partial/stale status object)", () => {
    mockUseBillingStatus.mockReturnValue({
      status: { entitlements: { features: { ai_coaching: { enabled: true, limit: null } } } },
      loading: false,
      isPremium: false,
    });
    const { result } = renderHook(() => useFeatureEntitlement("ai_coaching"));
    expect(result.current.entitled).toBe(false);
  });

  it("fails closed while loading, even if the last known status was entitled", () => {
    mockUseBillingStatus.mockReturnValue({
      status: { entitlements: { features: { ai_coaching: { enabled: true, limit: null } } } },
      loading: true,
      isPremium: true,
    });
    const { result } = renderHook(() => useFeatureEntitlement("ai_coaching"));
    expect(result.current.entitled).toBe(false);
    expect(result.current.loading).toBe(true);
  });

  it("checks the exact feature key passed in, not a different one that happens to be enabled", () => {
    mockUseBillingStatus.mockReturnValue({
      status: { entitlements: { features: { advanced_forecasting: { enabled: true, limit: null } } } },
      loading: false,
      isPremium: true,
    });
    const { result } = renderHook(() => useFeatureEntitlement("ai_coaching"));
    expect(result.current.entitled).toBe(false);
  });
});
