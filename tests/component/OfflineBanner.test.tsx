/**
 * tests/component/OfflineBanner.test.tsx
 *
 * Sprint 18 — Phase 4. Tests components/pwa/OfflineBanner.tsx.
 *
 * Mocks lib/analytics's trackEvent (avoids any real PostHog network calls
 * from jsdom) and drives real `online`/`offline` window events rather than
 * mocking useOnlineStatus itself — this exercises the actual event-listener
 * wiring in lib/hooks/useOnlineStatus.ts too, not just OfflineBanner's own
 * rendering logic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import OfflineBanner from "@/components/pwa/OfflineBanner";

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
  AnalyticsEvents: {
    OFFLINE_SESSION_STARTED: "offline_session_started",
    OFFLINE_SESSION_ENDED: "offline_session_ended",
  },
}));

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true, writable: true });
  window.dispatchEvent(new Event(value ? "online" : "offline"));
}

describe("OfflineBanner", () => {
  beforeEach(() => {
    localStorage.clear();
    setOnline(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing while online", () => {
    render(<OfflineBanner />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the offline banner with 'You're offline' text when the browser goes offline", async () => {
    render(<OfflineBanner />);
    act(() => setOnline(false));
    await waitFor(() => {
      expect(screen.getByText(/You're offline/)).toBeInTheDocument();
    });
  });

  it("shows a 'Back online' toast when transitioning from offline back to online", async () => {
    render(<OfflineBanner />);
    act(() => setOnline(false));
    await waitFor(() => expect(screen.getByText(/You're offline/)).toBeInTheDocument());

    act(() => setOnline(true));
    await waitFor(() => {
      expect(screen.getByText(/Back online/)).toBeInTheDocument();
    });
  });

  it("does NOT show a 'Back online' toast on first mount while already online (no prior offline session this session)", () => {
    render(<OfflineBanner />);
    expect(screen.queryByText(/Back online/)).not.toBeInTheDocument();
  });

  it("includes a 'last synced' hint once a synced timestamp exists", async () => {
    // useLastSyncedAt writes a timestamp to localStorage while online, before
    // any offline transition — simulate that having already happened.
    localStorage.setItem("sq_last_synced_at", String(Date.now() - 5 * 60 * 1000));
    render(<OfflineBanner />);
    act(() => setOnline(false));
    await waitFor(() => {
      expect(screen.getByText(/last synced/)).toBeInTheDocument();
    });
  });
});
