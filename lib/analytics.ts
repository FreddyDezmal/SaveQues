/**
 * lib/analytics.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Provider-agnostic analytics abstraction for SaveQuest.
 *
 * DESIGN PRINCIPLES
 * • Never import PostHog (or any vendor) directly from application code.
 * • All calls route through trackEvent() / identifyUser() here.
 * • Swapping providers = change providers/posthog.ts only.
 * • Server-safe: guards against SSR where window is undefined.
 * • Privacy-safe: no PII in event names; userId is a UUID, never email.
 * • Fire-and-forget: analytics must never throw or block the UI.
 *
 * USAGE (client components)
 *   import { trackEvent, identifyUser } from "@/lib/analytics";
 *   trackEvent("deposit_made", { amount: 500, goal_id: "...", goal_category: "travel" });
 *
 * USAGE (server routes)
 *   import { trackServerEvent } from "@/lib/analytics";
 *   trackServerEvent("deposit_made", userId, { amount: 500 });
 */

// ── Provider interface ────────────────────────────────────────────────────────

export interface AnalyticsProvider {
  /**
   * Identify a user so subsequent events are attributed correctly.
   * Call once after login / signup.
   */
  identify(userId: string, traits?: Record<string, unknown>): void;

  /**
   * Record a discrete action or state change.
   */
  capture(eventName: string, properties?: Record<string, unknown>): void;

  /**
   * Flush any queued events (useful in API routes before the function exits).
   */
  flush?(): Promise<void>;
}

// ── Singleton provider registry ───────────────────────────────────────────────

let _provider: AnalyticsProvider | null = null;

/**
 * Register the analytics provider.
 * Call once from your top-level layout or _app equivalent.
 * E.g.:  registerProvider(createPostHogProvider());
 */
export function registerProvider(provider: AnalyticsProvider): void {
  _provider = provider;
}

function getProvider(): AnalyticsProvider | null {
  return _provider;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Track an analytics event.
 * Safe to call from both client and server components.
 * Never throws — errors are silently caught so analytics never breaks the app.
 */
export function trackEvent(
  eventName: string,
  properties?: Record<string, unknown>
): void {
  try {
    getProvider()?.capture(eventName, properties);
  } catch (err) {
    // Analytics must never surface errors to users
    if (process.env.NODE_ENV === "development") {
      console.warn("[analytics] trackEvent error:", err);
    }
  }
}

/**
 * Identify the current user.
 * Call after successful login or signup.
 * traits should never include raw PII — use anonymised/aggregated values.
 */
export function identifyUser(
  userId: string,
  traits?: Record<string, unknown>
): void {
  try {
    getProvider()?.identify(userId, traits);
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[analytics] identifyUser error:", err);
    }
  }
}

/**
 * Flush queued events.
 * Call at the end of API route handlers to ensure delivery before the
 * serverless function exits.
 */
export async function flushAnalytics(): Promise<void> {
  try {
    await getProvider()?.flush?.();
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[analytics] flush error:", err);
    }
  }
}

// ── Typed Event Catalog ───────────────────────────────────────────────────────
// Keeping event names as constants prevents typos and enables autocomplete.

export const AnalyticsEvents = {
  // Auth
  SIGNUP_STARTED:    "signup_started",
  SIGNUP_COMPLETED:  "signup_completed",
  LOGIN_SUCCESS:     "login_success",
  LOGIN_FAILED:      "login_failed",

  // Goals
  GOAL_CREATED:      "goal_created",
  GOAL_EDITED:       "goal_edited",
  GOAL_COMPLETED:    "goal_completed",
  GOAL_DELETED:      "goal_deleted",

  // Transactions
  DEPOSIT_MADE:      "deposit_made",
  WITHDRAWAL_MADE:   "withdrawal_made",

  // XP
  XP_AWARDED:        "xp_awarded",
  LEVEL_UP:          "level_up",

  // Achievements
  ACHIEVEMENT_UNLOCKED: "achievement_unlocked",

  // Quests
  DAILY_QUEST_COMPLETED:      "daily_quest_completed",
  WEEKLY_QUEST_COMPLETED:     "weekly_quest_completed",
  SEASONAL_CHALLENGE_COMPLETED: "seasonal_challenge_completed",

  // Events
  EVENT_JOINED:      "event_joined",
  EVENT_COMPLETED:   "event_completed",

  // Activation milestones (fire once per user)
  FIRST_GOAL_CREATED:    "first_goal_created",
  FIRST_DEPOSIT:         "first_deposit",
  FIRST_ACHIEVEMENT:     "first_achievement",
  FIRST_QUEST_COMPLETED: "first_quest_completed",

  // Onboarding — Sprint 6
  // GOAL_CREATED already exists above; analytics payload adds source="onboarding"|"manual"
  ONBOARDING_COMPLETED:          "onboarding_completed",
  NOTIFICATION_PROMPT_SHOWN:     "notification_prompt_shown",
  NOTIFICATION_PROMPT_ACCEPTED:  "notification_prompt_accepted",
  NOTIFICATION_PROMPT_DISMISSED: "notification_prompt_dismissed",

  // Sprint 10 — Financial Integrity & Write Consolidation
  NOTIFICATIONS_ENABLED: "notifications_enabled",
  ACCOUNT_DELETED:       "account_deleted",
} as const;

export type AnalyticsEventName = (typeof AnalyticsEvents)[keyof typeof AnalyticsEvents];