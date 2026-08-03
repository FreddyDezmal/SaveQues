/**
 * tests/component/useGatedDownload.test.tsx
 * Sprint 30 — Phase 9/13: Upgrade Experience.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useGatedDownload } from "@/lib/hooks/useGatedDownload";

describe("useGatedDownload", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("surfaces the server's exact message and usage numbers on a 403, without attempting a download", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 403,
        ok: false,
        json: async () => ({ error: "You've reached your plan's export limit (5) for this period. Upgrade to Premium for unlimited access.", limit: 5, used: 5 }),
      })
    );
    const createObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });

    const { result } = renderHook(() => useGatedDownload());

    await act(async () => {
      await result.current.download("/api/export/transactions", "transactions.csv");
    });

    await waitFor(() => expect(result.current.blocked).not.toBeNull());
    expect(result.current.blocked?.message).toContain("export limit");
    expect(result.current.blocked?.limit).toBe(5);
    expect(result.current.blocked?.used).toBe(5);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(result.current.downloading).toBeNull();
  });

  it("downloads the CSV blob and clears any previous blocked state on success", async () => {
    const blob = new Blob(["a,b\n1,2"], { type: "text/csv" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 200, ok: true, blob: async () => blob })
    );
    const createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    const { result } = renderHook(() => useGatedDownload());

    await act(async () => {
      await result.current.download("/api/export/transactions", "transactions.csv");
    });

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    expect(result.current.blocked).toBeNull();
    expect(result.current.downloading).toBeNull();
  });

  it("shows a generic, honest message (not blocked-for-plan wording) on a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const { result } = renderHook(() => useGatedDownload());

    await act(async () => {
      await result.current.download("/api/export/transactions", "transactions.csv");
    });

    await waitFor(() => expect(result.current.blocked).not.toBeNull());
    expect(result.current.blocked?.message).not.toContain("Upgrade to Premium");
    expect(result.current.blocked?.limit).toBeNull();
  });

  it("clearBlocked resets the blocked state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 403, ok: false, json: async () => ({ error: "blocked", limit: 5, used: 5 }) })
    );
    vi.stubGlobal("URL", { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() });

    const { result } = renderHook(() => useGatedDownload());
    await act(async () => {
      await result.current.download("/api/export/goals", "goals.csv");
    });
    await waitFor(() => expect(result.current.blocked).not.toBeNull());

    act(() => result.current.clearBlocked());
    expect(result.current.blocked).toBeNull();
  });
});
