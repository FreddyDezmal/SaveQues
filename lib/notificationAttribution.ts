/**
 * lib/notificationAttribution.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 27, Phase 11 — Notification Analytics: "Converted" tracking.
 *
 * Attributes a real user action (a deposit, today — see §"scope" below)
 * to the most recent notification the user clicked that plausibly led to
 * it, marking that notification_logs row's converted_at.
 *
 * SCOPE, STATED HONESTLY: this phase wires conversion attribution into
 * ONE real call site — deposit creation (app/api/transactions/route.ts)
 * — not all ~30 notification types. That's a deliberate choice, not an
 * oversight left to look accidentally complete: "a deposit shortly after
 * clicking a savings reminder" is this app's single most valuable and
 * unambiguous conversion signal, and matches the product framing this
 * whole sprint has used ("make SaveQuest feel alive"). Attributing other
 * actions (a partner nudge leading to the partner logging in, a group
 * invite leading to someone joining) would need the same pattern applied
 * at each of those action's own call sites — straightforward to add
 * given this helper already exists, genuinely not done yet. Documented
 * as recommended follow-up in SPRINT27_PHASE11_NOTIFICATION_ANALYTICS.md,
 * not silently claimed as comprehensive.
 *
 * Best-effort by design, same as every notification send in this
 * codebase (lib/notifications.ts's senders are all fire-and-forget with
 * .catch() at the call site) — a failure here must NEVER affect the
 * underlying action (a deposit) it's trying to attribute. Every caller
 * is expected to call this without awaiting it and with a .catch().
 */
import { createServiceClient } from "./supabase/server";
import type { NotificationType } from "./types.notifications";

/** Notification types plausibly followed by a deposit — the "relevant
 *  types" list for deposit-attribution specifically. A different action
 *  (were one wired up later) would define its own list; this isn't a
 *  global "every type that can ever convert" registry. */
export const DEPOSIT_ATTRIBUTABLE_TYPES: NotificationType[] = [
  "streak_at_risk",
  "daily_quest",
  "goal_almost_complete",
  "goal_deadline_approaching",
  "missed_weekly_deposit",
  "weekly_expiry",
  "seasonal_expiry",
];

/**
 * Marks the most recent CLICKED-but-not-yet-converted notification of a
 * relevant type for this user (within `withinMinutes`) as converted.
 * Picks at most one row — if a user clicked several relevant
 * notifications in the window, attribution goes to whichever was
 * clicked most recently, on the reasoning that the freshest click is
 * the most plausible trigger for an action happening right now. This is
 * a heuristic, not a certainty — documented as a known limitation
 * rather than presented as precise causal attribution.
 */
export async function attributeConversion(
  userId: string,
  relevantTypes: NotificationType[],
  withinMinutes: number = 60 * 24 // 24 hours — generous enough to catch "saw it this morning, deposited tonight"
): Promise<void> {
  const supabase = createServiceClient();
  const sinceISO = new Date(Date.now() - withinMinutes * 60000).toISOString();

  const { data } = await supabase
    .from("notification_logs")
    .select("id")
    .eq("user_id", userId)
    .in("notification_type", relevantTypes)
    .not("clicked_at", "is", null)
    .is("converted_at", null)
    .gte("clicked_at", sinceISO)
    .order("clicked_at", { ascending: false })
    .limit(1);

  const candidate = data?.[0];
  if (!candidate) return;

  await supabase
    .from("notification_logs")
    .update({ converted_at: new Date().toISOString() })
    .eq("id", candidate.id)
    .is("converted_at", null); // idempotent — a retry/race writes this at most once
}
