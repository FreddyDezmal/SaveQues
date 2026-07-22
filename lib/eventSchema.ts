/**
 * lib/eventSchema.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 24 (Product Intelligence Platform) — Phase 1: Product Event
 * Architecture.
 *
 * Audit before writing this: lib/analytics.ts's trackEvent() and
 * lib/analytics-server.ts's trackServerEvent() already exist, are used
 * from ~44 call sites across quests/deposits/achievements/notifications/
 * referrals/etc, and are deliberately provider-agnostic (PostHog is an
 * implementation detail behind them — see analytics.ts's own header).
 * NONE of that is replaced here. This file adds ONE thing on top: a
 * canonical envelope shape (event_id/event_name/user_id/session_id/
 * device/platform/timestamp/context/metadata/version/source — the exact
 * fields the Sprint 24 brief asks every event to carry) and a single
 * trackCanonicalEvent() entrypoint that fills it in and calls the
 * EXISTING trackEvent()/trackServerEvent() underneath, rather than
 * talking to PostHog directly a second way.
 *
 * WHY EXISTING CALL SITES AREN'T MIGRATED IN THIS CHANGE
 *   Rewriting 44 call sites across the quest/deposit/achievement/social
 *   systems to go through a new function is a real, separate, riskier
 *   change — touching working reward-granting code paths in a fintech
 *   app for a schema-consistency improvement, with no behavioural bug
 *   being fixed, is exactly the kind of change that should be its own
 *   reviewable diff, not bundled into "add an event schema." What ships
 *   here is the shared contract itself, ready for (a) new events going
 *   forward and (b) a deliberate, separate migration of existing call
 *   sites later if that's wanted. Flagging this explicitly rather than
 *   quietly leaving the schema unused by anything real.
 *
 * WHY session_id/device ARE OPTIONAL, CALLER-SUPPLIED FIELDS
 *   PostHog's own client-side SDK already auto-captures $session_id and
 *   $device_type on every event (see providers/posthog.ts) — that's a
 *   more reliable source for "what browser session/device was this"
 *   than anything this server-agnostic library code could compute
 *   itself, especially for trackServerEvent() calls, which have no
 *   browser session at all. These two envelope fields exist for cases
 *   where the CALLER has an app-level session/device concept worth
 *   recording explicitly (e.g. a background job processing a specific
 *   request) — they default to null, not to a guess.
 */

import { trackEvent } from "@/lib/analytics";
import { trackServerEvent } from "@/lib/analytics-server";

/** Bump only if a BREAKING change is made to this envelope's shape (a field is removed/renamed, not just added). Consumers reading raw PostHog events can branch on this. */
export const EVENT_SCHEMA_VERSION = "1";

export interface CanonicalEventEnvelope {
  event_id: string;
  event_name: string;
  user_id: string | null;
  session_id: string | null;
  device: string | null;
  platform: "web";
  timestamp: string; // ISO 8601
  /** Where/how this event happened — page, referrer, feature area. Distinct from `metadata`: context describes the SITUATION, metadata describes the EVENT'S OWN data. */
  context: Record<string, unknown>;
  /** The event's own data — e.g. { goal_id, amount } for "Deposit Added". */
  metadata: Record<string, unknown>;
  version: typeof EVENT_SCHEMA_VERSION;
  source: "client" | "server";
}

export interface TrackCanonicalEventOptions {
  userId?: string | null;
  sessionId?: string | null;
  device?: string | null;
  context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

function buildEnvelope(
  eventName: string,
  source: "client" | "server",
  opts: TrackCanonicalEventOptions
): CanonicalEventEnvelope {
  return {
    event_id: crypto.randomUUID(),
    event_name: eventName,
    user_id: opts.userId ?? null,
    session_id: opts.sessionId ?? null,
    device: opts.device ?? null,
    platform: "web",
    timestamp: new Date().toISOString(),
    context: opts.context ?? {},
    metadata: opts.metadata ?? {},
    version: EVENT_SCHEMA_VERSION,
    source,
  };
}

/**
 * Client-side canonical event. Fire-and-forget, never throws — matches
 * trackEvent()'s own "analytics must never surface errors to users"
 * contract, since this calls straight through to it.
 */
export function trackCanonicalEvent(eventName: string, opts: TrackCanonicalEventOptions = {}): void {
  const envelope = buildEnvelope(eventName, "client", opts);
  // Deliberately NOT flattened into PostHog's top-level property bag —
  // context/metadata stay as nested objects so the envelope shape
  // (queryable in PostHog as event.properties.metadata.whatever) matches
  // what this file/the brief documents, rather than silently diverging
  // into a flat ad-hoc shape per call site again.
  trackEvent(eventName, envelope as unknown as Record<string, unknown>);
}

/**
 * Server-side canonical event. Requires userId (trackServerEvent()
 * itself requires a distinct_id — there's no server-side "anonymous
 * session" the way a browser has one).
 */
export async function trackCanonicalServerEvent(
  eventName: string,
  userId: string,
  opts: Omit<TrackCanonicalEventOptions, "userId"> = {}
): Promise<void> {
  const envelope = buildEnvelope(eventName, "server", { ...opts, userId });
  await trackServerEvent(eventName, userId, envelope as unknown as Record<string, unknown>);
}