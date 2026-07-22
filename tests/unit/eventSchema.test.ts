/**
 * tests/unit/eventSchema.test.ts
 * Sprint 24 — Phase 1: Product Event Architecture.
 *
 * trackEvent()/trackServerEvent() are mocked since they reach into
 * providers/posthog(-server).ts — this file only verifies the envelope
 * this module builds and hands to them, not PostHog delivery itself
 * (that's already lib/analytics.ts's own concern/tests, untouched here).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/analytics-server", () => ({ trackServerEvent: vi.fn() }));

import { trackEvent } from "@/lib/analytics";
import { trackServerEvent } from "@/lib/analytics-server";
import { trackCanonicalEvent, trackCanonicalServerEvent, EVENT_SCHEMA_VERSION } from "@/lib/eventSchema";

describe("trackCanonicalEvent", () => {
  it("passes an envelope with all required canonical fields to trackEvent()", () => {
    trackCanonicalEvent("Goal Created", { userId: "u1", metadata: { category: "travel" } });
    const [eventName, envelope] = (trackEvent as any).mock.calls[0];
    expect(eventName).toBe("Goal Created");
    expect(envelope.event_name).toBe("Goal Created");
    expect(envelope.user_id).toBe("u1");
    expect(envelope.metadata).toEqual({ category: "travel" });
    expect(envelope.version).toBe(EVENT_SCHEMA_VERSION);
    expect(envelope.source).toBe("client");
    expect(envelope.platform).toBe("web");
    expect(typeof envelope.event_id).toBe("string");
    expect(envelope.event_id.length).toBeGreaterThan(0);
    expect(() => new Date(envelope.timestamp).toISOString()).not.toThrow();
  });

  it("gives every call a unique event_id", () => {
    trackCanonicalEvent("Quest Completed");
    trackCanonicalEvent("Quest Completed");
    const [, first] = (trackEvent as any).mock.calls.at(-2);
    const [, second] = (trackEvent as any).mock.calls.at(-1);
    expect(first.event_id).not.toBe(second.event_id);
  });

  it("defaults user_id/session_id/device to null and context/metadata to empty objects when omitted", () => {
    trackCanonicalEvent("Leaderboard Viewed");
    const [, envelope] = (trackEvent as any).mock.calls.at(-1);
    expect(envelope.user_id).toBeNull();
    expect(envelope.session_id).toBeNull();
    expect(envelope.device).toBeNull();
    expect(envelope.context).toEqual({});
    expect(envelope.metadata).toEqual({});
  });
});

describe("trackCanonicalServerEvent", () => {
  it("passes userId through to trackServerEvent() both as the distinct_id argument and inside the envelope", async () => {
    await trackCanonicalServerEvent("Achievement Earned", "u42", { metadata: { badge: "first_deposit" } });
    const [eventName, userId, envelope] = (trackServerEvent as any).mock.calls.at(-1);
    expect(eventName).toBe("Achievement Earned");
    expect(userId).toBe("u42");
    expect(envelope.user_id).toBe("u42");
    expect(envelope.source).toBe("server");
    expect(envelope.metadata).toEqual({ badge: "first_deposit" });
  });
});
