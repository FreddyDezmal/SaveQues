/**
 * lib/notifications.ts
 * Core notification dispatch logic — used by cron job and manual triggers.
 */

import { createServiceClient } from "./supabase/server";
import { sendPush, type PushSendResult } from "./push";
import type { NotificationType, PushPayload, PushSubscriptionRow } from "./types.notifications";
import { getDaysRemainingInWeek, getWeekStart } from "./weeklyQuests";
import { formatAmount } from "./currency";
import { getLevelFromXP } from "./xp";
import { getUTCDateString, getUTCMonthString, getLastNUTCDateStrings } from "./dateUtils";
import { getMomentumState } from "./momentum";
import { ACHIEVEMENTS } from "./achievements";
import {
  buildSmartSavingsReminderCopy,
  buildStreakReminderCopy,
  buildGoalAlmostCompleteCopy,
  buildGoalDeadlineCopy,
  buildMissedWeeklyDepositCopy,
  buildGroupQuestEndingCopy,
  pickNearestGoal,
  shouldSendGoalAlmostComplete,
  shouldSendGoalDeadlineApproaching,
  goalDaysRemaining,
  isWithinQuietHours,
  isVacationActive,
  type ReminderGoalSnapshot,
  type ReminderLevelSnapshot,
} from "./reminderEngine";
import {
  groupDailyIntoWeeks,
  findBestAndWorstWeek,
  buildWeeklyDigestPushCopy,
  buildMonthlyDigestPushCopy,
  type WeeklyDigestData,
  type MonthlyDigestData,
} from "./digest";
import { renderNotificationTemplate } from "./notificationTemplates";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the calendar date (YYYY-MM-DD) in the given timezone, optionally
 * offset by `dayOffset` days (e.g. -1 for "yesterday in this timezone").
 *
 * Exported (Sprint 11 Phase 5) so it can be unit tested directly and
 * reused by shouldNotifyUserNow() below, without duplicating the
 * Intl.DateTimeFormat fallback logic.
 */
export function todayInTZ(tz: string, dayOffset = 0): string {
  try {
    const d = new Date();
    if (dayOffset !== 0) d.setUTCDate(d.getUTCDate() + dayOffset);
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
  } catch {
    const d = new Date();
    if (dayOffset !== 0) d.setUTCDate(d.getUTCDate() + dayOffset);
    return d.toISOString().slice(0, 10);
  }
}

/** Exported (Sprint 11 Phase 5) for the same reason as todayInTZ() above. */
export function currentHourInTZ(tz: string): number {
  try {
    return parseInt(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(new Date()),
      10
    );
  } catch {
    return new Date().getUTCHours();
  }
}

/**
 * shouldNotifyUserNow() — Sprint 11 Phase 5: extracted from inline logic
 * inside runDailyNotificationScheduler() so it can be unit tested directly.
 * This is the EXACT gating decision migration 017 introduced to make
 * once-daily cron invocation correct (see that migration's comments, and
 * Sprint 11 Phase 1's investigation, which verified this logic against
 * the original Scaling Audit's claim that it was broken — it is not; this
 * extraction changes nothing about its behavior, only its testability).
 *
 * Pure function: no DB access, no side effects, deterministic given its
 * inputs. The scheduler computes localHour/today from the live clock via
 * currentHourInTZ()/todayInTZ() and passes them in; tests can pass fixed
 * values to exercise specific scenarios without mocking the system clock.
 *
 * @param today                      Today's date in the user's local timezone (YYYY-MM-DD).
 * @param localHour                  Current hour (0-23) in the user's local timezone.
 * @param notificationHour           User's preferred notification hour (0-23).
 * @param lastNotificationSentDate   Date this user was last notified (their local date), or null/undefined if never.
 * @param yesterdayInTZ              Yesterday's date in the user's local timezone (YYYY-MM-DD) — passed in rather than recomputed so callers control exactly which "yesterday" definition is used (matches todayInTZ(timezone, -1) in the scheduler).
 * @returns true if this user should be notified on this run.
 */
export function shouldNotifyUserNow(params: {
  today: string;
  localHour: number;
  notificationHour: number;
  lastNotificationSentDate: string | null | undefined;
  yesterdayInTZ: string;
}): boolean {
  const { today, localHour, notificationHour, lastNotificationSentDate, yesterdayInTZ } = params;

  // Already notified today (their local date) — never double-send within
  // the same local day, even if the cron is somehow triggered twice.
  if (lastNotificationSentDate === today) return false;

  // Overdue: never notified, or last notified before yesterday (their
  // local date) — guarantees at least one notification per day even if
  // the single daily cron always lands before this user's preferred hour.
  const isOverdue = !lastNotificationSentDate || lastNotificationSentDate < yesterdayInTZ;

  // Not yet at their preferred hour, and not overdue — wait for a later run.
  if (localHour < notificationHour && !isOverdue) return false;

  return true;
}

/**
 * Create a notification_logs row BEFORE sending, so its id can be embedded
 * in the push payload (sw.js reads payload.notificationId to POST
 * /api/notifications/track on "push" and "notificationclick" events).
 *
 * BUGFIX: previously the log row was created AFTER sendWebPush() with no
 * way to pass the resulting id back into the already-sent payload, so
 * notificationId was always undefined in the service worker — meaning
 * delivered_at/clicked_at could never be set and admin delivery/click
 * rates always showed 0%.
 */
async function createPendingLog(
  userId: string,
  subscriptionId: string | null,
  type: NotificationType,
  title: string,
  body: string,
  deepLink: string
): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("notification_logs")
    .insert({
      user_id:           userId,
      subscription_id:   subscriptionId,
      notification_type: type,
      title,
      body,
      // Sprint 27, Phase 2: this was already being computed as the `url`
      // param below (used for the push payload's click destination) but
      // was never persisted — meaning the in-app Notification Center had
      // NO deep link data at all until now. Same value, just also saved.
      deep_link: deepLink,
    })
    .select("id")
    .single();

  if (error) console.error("[notifications] Failed to create log row:", error);
  return data?.id ?? "";
}

/** Record the send result (error, if any) on an existing log row. */
/**
 * Sprint 27, Phase 13: pure — groups a set of (userId, timezone) pairs by
 * each user's own local "today" date string. Used to batch the
 * daily_quest_logs lookup below by shared date instead of querying once
 * per user (a real N+1 this phase fixed) — extracted as its own
 * function specifically so this grouping logic has real unit test
 * coverage without needing to mock Supabase, same "extract the pure
 * decision, test that" pattern lib/webpush.ts's isRetryable() and
 * lib/reminderEngine.ts's pure functions already established.
 */
export function groupUserIdsByLocalToday(
  users: { userId: string; timezone: string }[]
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const { userId, timezone } of users) {
    const today = todayInTZ(timezone);
    const list = grouped.get(today) ?? [];
    list.push(userId);
    grouped.set(today, list);
  }
  return grouped;
}

async function updateLogResult(logId: string, result: PushSendResult): Promise<void> {
  if (!logId) return;
  const supabase = createServiceClient();
  await supabase
    .from("notification_logs")
    .update({ error: result.ok ? null : (result.error ?? `HTTP ${result.status}`) })
    .eq("id", logId);
}

async function deactivateSubscription(endpoint: string) {
  const supabase = createServiceClient();
  // Sprint 27, Phase 13: explicitly set updated_at — push_subscriptions
  // has no DB trigger to auto-maintain this column (confirmed by
  // auditing every migration that touches this table), so without this
  // it silently kept whatever value it last had, which meant it never
  // actually reflected WHEN a subscription went inactive. That made it
  // useless for the retention cleanup below, which needs exactly that.
  await supabase
    .from("push_subscriptions")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("endpoint", endpoint);
}

/**
 * Sprint 27, Phase 8: batch-fetches which of `userIds` already received a
 * notification of `type` since `sinceISO` — the shared building block for
 * "don't re-send this period's notification if the scheduler somehow runs
 * twice." One implementation instead of a bespoke inline query re-typed
 * in each scheduler; used by the weekly/monthly digest schedulers and the
 * group weekly summary scheduler below, and also now backs
 * goal_almost_complete's existing 14-day dedupe (previously a standalone
 * inline query with the same shape).
 */
async function getRecentlyNotifiedUserIds(
  userIds: string[],
  type: NotificationType,
  sinceISO: string
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("notification_logs")
    .select("user_id")
    .in("user_id", userIds)
    .eq("notification_type", type)
    .gte("sent_at", sinceISO);
  return new Set((data ?? []).map((r: any) => r.user_id));
}

/**
 * Sprint 27, Phase 8: atomically claims "notified today" for a user,
 * replacing what used to be an unconditional UPDATE (markNotifiedToday).
 *
 * THE RACE THIS CLOSES: the old version read shouldNotifyUserNow()'s
 * answer from the batch SELECT at the top of the run, then unconditionally
 * wrote last_notification_sent_date afterwards. If the cron were ever
 * invoked twice concurrently (a platform-level retry after a slow
 * response, or two overlapping requests from a misconfigured monitor) —
 * something Vercel Cron does not promise can't happen — both invocations
 * could read "not yet notified today" for the same user before either
 * had written back, and both would proceed to send. The write only ever
 * happened after the decision, never as part of it.
 *
 * The fix: the UPDATE itself is now the decision. It's conditioned on
 * last_notification_sent_date still not being today at write time (not
 * at the batch-read time earlier in the run), and the number of rows
 * actually updated (0 or 1) tells the caller whether IT won the claim.
 * Postgres's row-level locking during the UPDATE serializes two
 * concurrent attempts for the same user — only one can possibly see
 * itself update a row that still needs updating; the loser's WHERE
 * clause matches nothing.
 */
async function tryClaimDailyNotificationSlot(userId: string, localDate: string): Promise<boolean> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ last_notification_sent_date: localDate })
    .eq("id", userId)
    .or(`last_notification_sent_date.is.null,last_notification_sent_date.neq.${localDate}`)
    .select("id");

  if (error) {
    console.error("[daily-scheduler] Failed to claim notification slot:", error);
    return false; // fail closed — an unclaimed slot means no send this run, not a duplicate risk
  }
  return (data?.length ?? 0) > 0;
}

// ── Sprint 27, Phase 4: vacation mode ───────────────────────────────────────
//
// Checked inside sendToUser() — the one function every single notification
// path in this file (scheduled AND event-triggered) already funnels
// through — rather than adding a check to each of the ~20 individual send
// functions and schedulers. One choke point, guaranteed complete coverage,
// no risk of a future new sender forgetting to check it.
//
// "Today" here is UTC (getUTCDateString(), same helper lib/dateUtils.ts
// already centralizes for activity-tracking dates), not the user's local
// timezone. Known limitation, not silently glossed over: a vacation set to
// end on a specific date may start delivering notifications up to ~12
// hours before or after local midnight for users far from UTC. Exact
// per-timezone vacation boundaries would need the same per-user timezone
// plumbing runDailyNotificationScheduler() already has for other checks —
// out of scope for what's fundamentally a "pause everything for a while"
// feature where a half-day of imprecision at the edges doesn't undermine
// the point of it.
async function isUserOnVacation(userId: string): Promise<boolean> {
  const supabase = createServiceClient();
  const { data: prefs } = await supabase
    .from("notification_preferences")
    .select("vacation_mode, vacation_until")
    .eq("user_id", userId)
    .maybeSingle();

  if (!prefs) return false;
  return isVacationActive(prefs.vacation_mode, prefs.vacation_until, getUTCDateString());
}

// ── Send to one user ─────────────────────────────────────────────────────────

async function sendToUser(
  userId: string,
  type: NotificationType,
  title: string,
  body: string,
  url = "/dashboard"
): Promise<{ sent: number; errors: number }> {
  if (await isUserOnVacation(userId)) return { sent: 0, errors: 0 };

  const supabase = createServiceClient();

  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true);

  // ── One notification_logs row per EVENT, not per subscription ──────────
  // Bug found investigating a user report: they saw the same "streak at
  // risk" notification 3-4 times in the in-app Notification Center for a
  // single day. Root cause: this function used to create a
  // notification_logs row INSIDE the per-subscription loop below — a user
  // with N active push_subscriptions rows (multiple devices, or a stale
  // subscription pushsubscriptionchange swapped out but never explicitly
  // deactivated server-side) got N identical rows for one logical event.
  // GET /api/notifications/list has no dedup of its own — it just displays
  // notification_logs directly — so N rows meant N visible "notifications"
  // for something that happened once.
  //
  // Also fixes a related gap: previously this row was only created if the
  // user had at least one active subscription (the early return below).
  // A user who never enabled push (declined the permission prompt, or
  // hasn't gotten to it yet) got NO in-app record either — even though the
  // Notification Center is a real, independent piece of UI that shouldn't
  // require push opt-in to be useful.
  const logId = await createPendingLog(userId, null, type, title, body, url);

  if (!subs || subs.length === 0) return { sent: 0, errors: 0 };

  let sent = 0, errors = 0;

  for (const sub of subs as PushSubscriptionRow[]) {
    const payload: PushPayload = {
      title,
      body,
      icon:  "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      tag:   type,
      url,
      type,
      notificationId: logId || undefined,
    };

    // Sprint 27, Phase 10: routes through the push provider abstraction
    // instead of calling sendWebPushWithRetry() directly. Zero behavior
    // change today — selectPushProvider() defaults to the exact same
    // webpush implementation this call used before — but swapping to a
    // different push service later is now a config change here, not a
    // code change.
    const result = await sendPush(
      { target: sub.endpoint, webPushKeys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload
    );

    if (result.ok) {
      sent++;
    } else {
      errors++;
      if (result.gone) {
        await deactivateSubscription(sub.endpoint);
      }
    }
  }

  // Record delivery failure for observability (support/debugging can see
  // it via `error`), but only when EVERY device failed — and deliberately
  // don't use this to hide the row from the in-app list. The event itself
  // (streak at risk, friend accepted, etc.) genuinely happened regardless
  // of whether push delivery succeeded; in-app history should stay a
  // reliable record of that even on days push infra has a bad day.
  if (sent === 0 && errors > 0) {
    await updateLogResult(logId, { ok: false, error: "All active subscriptions failed to receive this push" });
  }

  return { sent, errors };
}

// ── Notification builders ────────────────────────────────────────────────────

export async function sendStreakAtRisk(userId: string, streakDays: number) {
  const { title, body } = buildStreakReminderCopy(streakDays);
  return sendToUser(userId, "streak_at_risk", title, body, "/dashboard");
}

/**
 * Sprint 27, Phase 3: `smartContext` is optional and defaults to the
 * original generic copy — so any existing/future caller that doesn't
 * pass it (there are none today; see the grep audit note in
 * SPRINT27_PHASE3_SMART_REMINDERS.md) keeps behaving exactly as before.
 * runDailyNotificationScheduler() below is the one caller that now
 * passes real numbers, per the sprint brief's "You're only R120 away
 * from reaching Level 12" example instead of "Save today!".
 */
export async function sendDailyQuestReminder(
  userId: string,
  smartContext?: { nearestGoal: ReminderGoalSnapshot | null; level: ReminderLevelSnapshot | null; currencyCode?: string }
) {
  const { title, body } = smartContext
    ? buildSmartSavingsReminderCopy(smartContext)
    : buildSmartSavingsReminderCopy({ nearestGoal: null, level: null });
  return sendToUser(userId, "daily_quest", title, body, "/quests");
}

// ── Sprint 27, Phase 3: Smart Reminder Engine ───────────────────────────────
//
// Three of these (goal_almost_complete, goal_deadline_approaching,
// missed_weekly_deposit) are user-scoped and fired from the existing
// per-user loop in runDailyNotificationScheduler() below — reusing its
// timezone gating, its notifications_enabled/goal_reminders preference
// checks, and its batched-query setup rather than standing up a second
// scheduler. group_quest_ending is group-scoped (many members per quest)
// so it gets its own scheduler, runGroupQuestEndingReminderScheduler(),
// following the exact batching pattern runGroupWeeklySummaryScheduler()
// already established below.

export async function sendGoalAlmostComplete(userId: string, goal: ReminderGoalSnapshot, currencyCode?: string) {
  const { title, body } = buildGoalAlmostCompleteCopy(goal, currencyCode);
  return sendToUser(userId, "goal_almost_complete", title, body, `/goals/${goal.id}`);
}

export async function sendGoalDeadlineApproaching(
  userId: string,
  goal: ReminderGoalSnapshot,
  daysLeft: number,
  currencyCode?: string
) {
  const { title, body } = buildGoalDeadlineCopy(goal, daysLeft, currencyCode);
  return sendToUser(userId, "goal_deadline_approaching", title, body, `/goals/${goal.id}`);
}

export async function sendMissedWeeklyDeposit(
  userId: string,
  nearestGoal: ReminderGoalSnapshot | null,
  currencyCode?: string
) {
  const { title, body } = buildMissedWeeklyDepositCopy(nearestGoal, currencyCode);
  // Sprint 27, Phase 6: only nearestGoal gives us anything more specific
  // than /dashboard to link to — with no active goal at all (nearestGoal
  // null), /dashboard genuinely is the most relevant landing spot, same
  // "system category legitimately falls back to /dashboard" reasoning
  // notificationActions.ts documents for other types.
  return sendToUser(userId, "missed_weekly_deposit", title, body, nearestGoal ? `/goals/${nearestGoal.id}` : "/dashboard");
}

async function sendGroupQuestEnding(
  userId: string,
  groupId: string,
  groupName: string,
  questTitle: string,
  daysLeft: number
): Promise<{ sent: number; errors: number }> {
  const { title, body } = buildGroupQuestEndingCopy(groupName, questTitle, daysLeft);
  return sendToUser(userId, "group_quest_ending", title, body, `/groups/${groupId}`);
}

export async function sendWeeklyQuestExpiry(userId: string, daysLeft: number) {
  const { title, body } = renderNotificationTemplate(
    daysLeft === 1 ? "weekly_expiry_one_day" : "weekly_expiry_many_days",
    { days: daysLeft }
  );
  return sendToUser(userId, "weekly_expiry", title, body, "/quests");
}

export async function sendSeasonalExpiry(userId: string, title: string, daysLeft: number) {
  const { title: pushTitle, body } = renderNotificationTemplate(
    daysLeft === 1 ? "seasonal_expiry_one_day" : "seasonal_expiry_many_days",
    { quest_title: title, days: daysLeft }
  );
  return sendToUser(userId, "seasonal_expiry", pushTitle, body, "/quests");
}

export async function sendInactiveReminder(userId: string, daysSinceActive: number) {
  const { title, body } = renderNotificationTemplate("inactive", { days: daysSinceActive });
  return sendToUser(userId, "inactive", title, body, "/dashboard");
}

// ── Sprint 17: completing Sprint 16's unfinished notification categories ────
//
// achievement_unlocked and milestone_celebration are triggered from an
// immediate, request-time code path (lib/awardXP.ts, called from the
// transactions and goal-purchase-complete API routes) rather than the
// daily cron scheduler above. That scheduler's own initial query already
// filters on profiles.notifications_enabled — this path doesn't go through
// that query, so it needs its own explicit two-part check: the same
// master switch, plus the specific notification_preferences category.
// Centralized here so both new send functions share one check rather than
// each re-implementing it slightly differently.

async function canSendNotificationToUser(
  userId: string,
  category: "achievements" | "milestone_celebrations" | "weekly_summaries" | "groups" | "partners" | "monthly_summaries"
): Promise<boolean> {
  const supabase = createServiceClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("notifications_enabled")
    .eq("id", userId)
    .maybeSingle();

  if (!profile?.notifications_enabled) return false;

  const { data: prefs } = await supabase
    .from("notification_preferences")
    .select(category)
    .eq("user_id", userId)
    .maybeSingle();

  // No preferences row yet (user never opened the preferences page) →
  // same "sensible default" behavior as everywhere else this sprint's
  // categories are checked: default to true, not false.
  return (prefs as any)?.[category] ?? true;
}

/**
 * Fires when a user unlocks an achievement — called from
 * checkAndAwardAchievements() in lib/awardXP.ts, fire-and-forget (not
 * awaited by the caller), specifically so a slow or failed push send can
 * never add latency to, or fail, the deposit/goal-completion request that
 * triggered it. See the call site for the full reasoning.
 */
export async function sendAchievementUnlocked(
  userId: string,
  achievementTitle: string,
  achievementIcon: string,
  achievementId: string
): Promise<{ sent: number; errors: number }> {
  const allowed = await canSendNotificationToUser(userId, "achievements");
  if (!allowed) return { sent: 0, errors: 0 };

  // Sprint 27, Phase 6: no /achievements/[id] detail route exists — the
  // achievements list IS the detail view (one card per earned badge), so
  // ?highlight=<id> scrolls to and highlights the specific card instead
  // of just opening the generic list. See AchievementsClient.tsx.
  const { title, body } = renderNotificationTemplate("achievement_unlocked", {
    achievement_icon: achievementIcon,
    achievement_title: achievementTitle,
  });
  return sendToUser(userId, "achievement_unlocked", title, body, `/achievements?highlight=${achievementId}`);
}

/**
 * Fires on goal completion — called from awardGoalCompleteXP() in
 * lib/awardXP.ts. Scoped specifically to goal completion (not e.g. every
 * round-number lifetime-savings threshold) for this pass — see the Sprint
 * 17 engineering audit for why broader milestone detection (lifetime
 * totals crossing $100/$500/$1000/etc.) is scoped to a future sprint
 * rather than guessed at here.
 */
export async function sendMilestoneCelebration(
  userId: string,
  goalTitle: string,
  goalId: string
): Promise<{ sent: number; errors: number }> {
  const allowed = await canSendNotificationToUser(userId, "milestone_celebrations");
  if (!allowed) return { sent: 0, errors: 0 };

  const { title, body } = renderNotificationTemplate("milestone_celebration", { goal_name: goalTitle });
  return sendToUser(userId, "milestone_celebration", title, body, `/goals/${goalId}`);
}

// ── Sprint 27, Phase 5: digest persistence ──────────────────────────────────
//
// Shared by both runWeeklySummaryScheduler() and runMonthlyDigestScheduler()
// below — one insert helper rather than two near-identical copies. Returns
// null (not throws) on failure so a digest-row write failure degrades to
// "notification still sends, just links to /dashboard instead of a specific
// digest page" rather than skipping the notification entirely — a missing
// deep link is a much smaller problem than a missing notification.
async function persistDigest(
  userId: string,
  digestType: "weekly" | "monthly",
  periodStart: string,
  periodEnd: string,
  payload: WeeklyDigestData | MonthlyDigestData
): Promise<string | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("user_digests")
    .insert({ user_id: userId, digest_type: digestType, period_start: periodStart, period_end: periodEnd, payload })
    .select("id")
    .single();

  if (error) {
    console.error(`[digest] Failed to persist ${digestType} digest:`, error);
    return null;
  }
  return data.id;
}

/**
 * Weekly savings recap — reuses the existing daily cron trigger rather
 * than requesting a new Vercel Cron schedule slot; runWeeklySummaryScheduler()
 * is called from app/api/cron/notifications/route.ts but internally no-ops
 * on every day except Monday. This keeps the "one new cron entry per
 * feature" footprint at zero for this addition.
 *
 * Sprint 27, Phase 5 update: now builds a full WeeklyDigestData (quests
 * completed, XP earned, level, streak, closest goal — everything the
 * sprint brief's weekly example lists), persists it to user_digests, and
 * deep-links the push to /digest/[id] instead of just /dashboard. The
 * push body itself stays a short highlight (see lib/digest.ts's own
 * comment on why) — the full breakdown lives on that page.
 */
export async function runWeeklySummaryScheduler(): Promise<{ processed: number; notifications_sent: number; errors: number }> {
  const supabase = createServiceClient();

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, currency_code, xp_total, streak_days")
    .eq("notifications_enabled", true);

  if (error || !profiles) {
    console.error("[weekly-summary] Failed to fetch profiles:", error);
    return { processed: 0, notifications_sent: 0, errors: 1 };
  }

  let notifications_sent = 0, errors = 0;
  const now = new Date();
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const periodStart = getUTCDateString(oneWeekAgo);
  const periodEnd = getUTCDateString(now);

  // Sprint 27, Phase 8: guards against a double-invoked Monday cron
  // sending everyone two weekly recaps. Uses the same rolling 7-day
  // window as totalSaved above (not a calendar-week boundary) — "already
  // notified within the last 7 days" is a strictly stronger guarantee
  // than "already notified this Monday," so it's safe even if the cron
  // fires on an unexpected day.
  const allUserIds = (profiles as any[]).map((p) => p.id);
  const alreadyNotifiedThisPeriod = await getRecentlyNotifiedUserIds(
    allUserIds, "weekly_summary", oneWeekAgo.toISOString()
  );

  for (const { id: userId, currency_code, xp_total, streak_days } of profiles as any[]) {
    if (alreadyNotifiedThisPeriod.has(userId)) continue;
    const allowed = await canSendNotificationToUser(userId, "weekly_summaries");
    if (!allowed) continue;

    // Sprint 27, Phase 8: per-user try/catch, same reasoning as
    // runDailyNotificationScheduler()'s own — a query failure or thrown
    // error for one user must not abort the recap for every other user
    // still to be processed in this run.
    try {
    const { data: deposits } = await supabase
      .from("transactions")
      .select("amount")
      .eq("user_id", userId)
      .eq("transaction_type", "deposit")
      .gte("created_at", oneWeekAgo.toISOString());

    const totalSaved = (deposits ?? []).reduce((sum, t: any) => sum + Number(t.amount), 0);

    // Skip the recap entirely for a user who saved nothing this week —
    // "you saved $0 this week" is not a motivational message, it's a
    // discouraging one, and this app's own notification philosophy
    // elsewhere (streak-at-risk, inactive reminders) is about prompting
    // action, not reporting a null result.
    if (totalSaved <= 0) continue;

    const [{ data: questLogs }, { data: activity }, { data: goals }] = await Promise.all([
      supabase.from("daily_quest_logs").select("id")
        .eq("user_id", userId).gte("quest_date", periodStart),
      supabase.from("activity_log").select("xp_earned")
        .eq("user_id", userId).gte("activity_date", periodStart),
      supabase.from("savings_goals")
        .select("id, title, goal_emoji, target_amount, current_amount, target_date, is_primary")
        .eq("user_id", userId).eq("is_complete", false).eq("is_active", true),
    ]);

    const nearestGoal = pickNearestGoal(
      (goals ?? []).map((g: any): ReminderGoalSnapshot => ({
        id: g.id,
        title: g.title,
        goalEmoji: g.goal_emoji,
        targetAmount: Number(g.target_amount),
        currentAmount: Number(g.current_amount),
        targetDate: g.target_date,
        isPrimary: g.is_primary,
      }))
    );

    const data: WeeklyDigestData = {
      periodStart,
      periodEnd,
      totalSaved,
      questsCompleted: (questLogs ?? []).length,
      xpEarned: (activity ?? []).reduce((sum: number, a: any) => sum + (a.xp_earned ?? 0), 0),
      level: getLevelFromXP(xp_total ?? 0).level,
      streakDays: streak_days ?? 0,
      closestGoal: nearestGoal
        ? { title: nearestGoal.title, remaining: Math.max(0, nearestGoal.targetAmount - nearestGoal.currentAmount) }
        : null,
    };

    const digestId = await persistDigest(userId, "weekly", periodStart, periodEnd, data);
    const r = await sendWeeklySummary(userId, data, currency_code, digestId);
    notifications_sent += r.sent;
    errors += r.errors;
    } catch (err) {
      console.error(`[weekly-summary] Failed processing user ${userId}:`, err);
      errors++;
    }
  }

  return { processed: profiles.length, notifications_sent, errors };
}

async function sendWeeklySummary(
  userId: string,
  data: WeeklyDigestData,
  currencyCode: string,
  digestId: string | null
): Promise<{ sent: number; errors: number }> {
  const { title, body } = buildWeeklyDigestPushCopy(data, currencyCode);
  return sendToUser(userId, "weekly_summary", title, body, digestId ? `/digest/${digestId}` : "/dashboard");
}

/**
 * Monthly digest — same "piggyback on the existing once-daily cron,
 * gate internally" shape as runWeeklySummaryScheduler() above, gated to
 * the 1st of the calendar month by the caller (app/api/cron/notifications
 * /route.ts) rather than inside this function, matching that file's
 * existing Monday-gate convention for the weekly jobs.
 *
 * Builds everything the sprint brief's monthly example lists: savings
 * graph, XP graph, quest progress, achievements, best/worst week,
 * momentum score. Momentum reuses lib/momentum.ts's existing 14-day
 * rolling calculation (see that file and lib/digest.ts's own comments
 * for why) — it is NOT a month-scoped metric, it's the same "momentum"
 * shown elsewhere in the app (e.g. MomentumHeatmap), included here for
 * continuity rather than inventing a second, different momentum number.
 */
export async function runMonthlyDigestScheduler(): Promise<{ processed: number; notifications_sent: number; errors: number }> {
  const supabase = createServiceClient();

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, currency_code")
    .eq("notifications_enabled", true);

  if (error || !profiles) {
    console.error("[monthly-digest] Failed to fetch profiles:", error);
    return { processed: 0, notifications_sent: 0, errors: 1 };
  }

  let notifications_sent = 0, errors = 0;
  const now = new Date();
  const periodStart = `${getUTCMonthString(now)}-01`;
  const periodEnd = getUTCDateString(now);
  const last14Days = getLastNUTCDateStrings(14);

  // Sprint 27, Phase 8: guards against a double-invoked 1st-of-month
  // cron sending everyone two monthly recaps. periodStart is this
  // calendar month's start, so "already notified since periodStart" is
  // exactly "already got this month's recap."
  const allUserIds = (profiles as any[]).map((p) => p.id);
  const alreadyNotifiedThisPeriod = await getRecentlyNotifiedUserIds(
    allUserIds, "monthly_summary", `${periodStart}T00:00:00.000Z`
  );

  for (const { id: userId, currency_code } of profiles as any[]) {
    if (alreadyNotifiedThisPeriod.has(userId)) continue;
    const allowed = await canSendNotificationToUser(userId, "monthly_summaries");
    if (!allowed) continue;

    // Sprint 27, Phase 8: per-user try/catch, same reasoning as
    // runDailyNotificationScheduler() and runWeeklySummaryScheduler()
    // above.
    try {
    const [{ data: deposits }, { data: questLogs }, { data: monthActivity }, { data: recentActivity }, { data: achievementRows }] =
      await Promise.all([
        supabase.from("transactions").select("amount, created_at")
          .eq("user_id", userId).eq("transaction_type", "deposit").gte("created_at", `${periodStart}T00:00:00.000Z`),
        supabase.from("daily_quest_logs").select("id")
          .eq("user_id", userId).gte("quest_date", periodStart),
        supabase.from("activity_log").select("activity_date, xp_earned")
          .eq("user_id", userId).gte("activity_date", periodStart),
        supabase.from("activity_log").select("activity_date, xp_earned")
          .eq("user_id", userId).gte("activity_date", last14Days[0]),
        supabase.from("user_achievements").select("achievement_id, earned_at")
          .eq("user_id", userId).gte("earned_at", `${periodStart}T00:00:00.000Z`),
      ]);

    const totalSaved = (deposits ?? []).reduce((sum: number, t: any) => sum + Number(t.amount), 0);
    if (totalSaved <= 0) continue; // same "don't report a null result" reasoning as the weekly digest

    const dailySavings = Object.entries(
      (deposits ?? []).reduce((acc: Record<string, number>, t: any) => {
        const day = getUTCDateString(new Date(t.created_at));
        acc[day] = (acc[day] ?? 0) + Number(t.amount);
        return acc;
      }, {})
    ).map(([date, value]) => ({ date, value: value as number }));

    const dailyXP = (monthActivity ?? []).map((a: any) => ({ date: a.activity_date, value: a.xp_earned ?? 0 }));

    const { best, worst } = findBestAndWorstWeek(groupDailyIntoWeeks(dailySavings));

    const achievementMap = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
    const achievements = (achievementRows ?? [])
      .map((r: any) => achievementMap.get(r.achievement_id))
      .filter((a): a is (typeof ACHIEVEMENTS)[number] => !!a)
      .map((a) => ({ id: a.id, title: a.title, icon: a.icon }));

    const data: MonthlyDigestData = {
      periodStart,
      periodEnd,
      totalSaved,
      xpEarned: (monthActivity ?? []).reduce((sum: number, a: any) => sum + (a.xp_earned ?? 0), 0),
      questsCompleted: (questLogs ?? []).length,
      achievements,
      dailySavings,
      dailyXP,
      bestWeek: best,
      worstWeek: worst,
      momentum: getMomentumState(
        (recentActivity ?? []).map((a: any) => ({ date: a.activity_date, xp_earned: a.xp_earned ?? 0 }))
      ),
    };

    const digestId = await persistDigest(userId, "monthly", periodStart, periodEnd, data);
    const r = await sendMonthlySummary(userId, data, currency_code, digestId);
    notifications_sent += r.sent;
    errors += r.errors;
    } catch (err) {
      console.error(`[monthly-digest] Failed processing user ${userId}:`, err);
      errors++;
    }
  }

  return { processed: profiles.length, notifications_sent, errors };
}

async function sendMonthlySummary(
  userId: string,
  data: MonthlyDigestData,
  currencyCode: string,
  digestId: string | null
): Promise<{ sent: number; errors: number }> {
  const { title, body } = buildMonthlyDigestPushCopy(data, currencyCode);
  return sendToUser(userId, "monthly_summary", title, body, digestId ? `/digest/${digestId}` : "/dashboard");
}

// ── Main scheduler — called by cron ─────────────────────────────────────────

export interface SchedulerResult {
  processed: number;
  notifications_sent: number;
  errors: number;
}

export async function runDailyNotificationScheduler(): Promise<SchedulerResult> {
  const supabase = createServiceClient();
  let processed = 0, notifications_sent = 0, errors = 0;

  // Fetch all active subscribers with their profile data
  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select(`
      user_id, timezone,
      profiles!inner(
        id, streak_days, last_active_date, last_notification_hour,
        last_notification_sent_date, notifications_enabled, xp_total, currency_code
      )
    `)
    .eq("is_active", true)
    .eq("profiles.notifications_enabled", true);

  if (error || !subs) {
    console.error("[notifications] Failed to fetch subscriptions:", error);
    return { processed: 0, notifications_sent: 0, errors: 1 };
  }

  // Sprint 16 — Phase 1: batch-fetch notification_preferences for every user
  // in this run, once, rather than a per-user query inside the loop below.
  // With potentially thousands of subscribers processed per cron run, N+1
  // queries here would be the kind of thing that only shows up as a
  // production slowdown much later — worth avoiding from the start rather
  // than "fixing efficiently later" per the sprint brief's Phase 2 note on
  // efficient logic applying in spirit here too.
  const userIds = (subs as any[]).map((s) => s.profiles?.id).filter(Boolean);
  const { data: prefRows } = await supabase
    .from("notification_preferences")
    .select("user_id, goal_reminders, streak_reminders, quiet_hours_enabled, quiet_hours_start, quiet_hours_end")
    .in("user_id", userIds);

  const prefsByUser = new Map<string, {
    goal_reminders: boolean;
    streak_reminders: boolean;
    quiet_hours_enabled: boolean;
    quiet_hours_start: number;
    quiet_hours_end: number;
  }>();
  for (const row of prefRows ?? []) {
    prefsByUser.set(row.user_id, {
      goal_reminders: row.goal_reminders,
      streak_reminders: row.streak_reminders,
      quiet_hours_enabled: row.quiet_hours_enabled,
      quiet_hours_start: row.quiet_hours_start,
      quiet_hours_end: row.quiet_hours_end,
    });
  }
  // Users with no preferences row yet (haven't visited the new preferences
  // page) get the same defaults the table itself defines — true for both —
  // so behavior for existing users is UNCHANGED until they explicitly
  // opt out. This is what "provide sensible defaults" means in practice:
  // the absence of a row is not treated as "assume everything off."
  function getPref(userId: string, key: "goal_reminders" | "streak_reminders"): boolean {
    return prefsByUser.get(userId)?.[key] ?? true;
  }

  // Sprint 27, Phase 4: quiet hours. Applies to the WHOLE per-user batch of
  // scheduled checks below (streak/quest/weekly/seasonal/goal/deposit — 1
  // through 8), not individually to each — quiet hours means "don't wake me
  // up," which is a blanket suppression, not a per-category one. Does NOT
  // cover event-triggered sends elsewhere in this file (achievement unlock,
  // partner request, friend accepted, etc.) — those fire the moment
  // something happens rather than from this once-daily batch, and applying
  // quiet hours to them would need a per-send-time check at every one of
  // those ~15 call sites rather than one check here. Documented gap, not
  // silently partial: the preferences UI says so explicitly.
  function isUserInQuietHours(userId: string, localHour: number): boolean {
    const p = prefsByUser.get(userId);
    if (!p) return false;
    return isWithinQuietHours(localHour, p.quiet_hours_enabled, p.quiet_hours_start, p.quiet_hours_end);
  }

  // Sprint 27, Phase 3 — Smart Reminder Engine: batch-fetch everything the
  // three new per-user reminder checks below need, once, for the same
  // "no N+1 across thousands of subscribers" reason prefRows above is
  // batched. All three pure decisions (which goal to reference, whether
  // it's almost-complete/deadline-close, what the copy says) live in
  // lib/reminderEngine.ts — this scheduler only fetches rows and calls in.

  const { data: goalRows } = await supabase
    .from("savings_goals")
    .select("id, user_id, title, goal_emoji, target_amount, current_amount, target_date, is_primary")
    .in("user_id", userIds)
    .eq("is_complete", false)
    .eq("is_active", true);

  const goalsByUser = new Map<string, ReminderGoalSnapshot[]>();
  for (const g of (goalRows ?? []) as any[]) {
    const snapshot: ReminderGoalSnapshot = {
      id: g.id,
      title: g.title,
      goalEmoji: g.goal_emoji,
      targetAmount: Number(g.target_amount),
      currentAmount: Number(g.current_amount),
      targetDate: g.target_date,
      isPrimary: g.is_primary,
    };
    const list = goalsByUser.get(g.user_id) ?? [];
    list.push(snapshot);
    goalsByUser.set(g.user_id, list);
  }

  // This week's deposits per user, for the "missed weekly deposit" check.
  const { data: weekDepositRows } = await supabase
    .from("transactions")
    .select("user_id, amount")
    .in("user_id", userIds)
    .eq("transaction_type", "deposit")
    .gte("created_at", getWeekStart());

  const weekDepositTotalByUser = new Map<string, number>();
  for (const t of (weekDepositRows ?? []) as any[]) {
    weekDepositTotalByUser.set(
      t.user_id,
      (weekDepositTotalByUser.get(t.user_id) ?? 0) + Number(t.amount)
    );
  }

  // ── Sprint 27, Phase 8: shared duplicate-prevention query ─────────────
  // Spam guard for goal_almost_complete: notification_logs has no goal_id
  // column (a schema change out of scope for this phase — see
  // reminderEngine.ts's file header), so this dedupes per-USER rather
  // than per-goal. Documented known limitation, not silently swept under
  // the rug: a user with two goals both crossing 90% in the same window
  // only gets reminded about one of them.
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();
  const recentlyRemindedAlmostComplete = await getRecentlyNotifiedUserIds(
    userIds, "goal_almost_complete", fourteenDaysAgo
  );

  // Deduplicate by user_id (one user may have multiple subscriptions)
  const usersToProcess = new Map<string, {
    timezone: string;
    notificationHour: number;
    streakDays: number;
    lastActiveDate: string | null;
    lastNotificationSentDate: string | null;
    xpTotal: number;
    currencyCode: string | undefined;
  }>();

  for (const sub of subs as any[]) {
    const p = sub.profiles;
    if (!p) continue;
    usersToProcess.set(p.id, {
      timezone:                  sub.timezone ?? "UTC",
      notificationHour:          p.last_notification_hour ?? 20, // default 8 PM
      streakDays:                p.streak_days ?? 0,
      lastActiveDate:            p.last_active_date,
      lastNotificationSentDate:  p.last_notification_sent_date,
      xpTotal:                   p.xp_total ?? 0,
      currencyCode:              p.currency_code ?? undefined,
    });
  }

  // Sprint 27, Phase 13: batch daily_quest_logs instead of querying once
  // per user inside the loop below (a real N+1, flagged as follow-up
  // work in Phase 8's own doc). Can't do this in ONE query for every
  // user the way goals/deposits are batched elsewhere in this function —
  // "today" is genuinely per-user here (it depends on each user's own
  // timezone, computed via todayInTZ() below), unlike the weekly/monthly
  // schedulers' single shared period. Instead: group users by their own
  // "today" value first (bounded by the number of distinct timezones
  // actually represented in this run — worst case ~30-ish UTC offsets,
  // not one query per user), then one batched query per group.
  const usersByToday = groupUserIdsByLocalToday(
    Array.from(usersToProcess.entries()).map(([userId, info]) => ({ userId, timezone: info.timezone }))
  );

  const usersWithQuestLogToday = new Set<string>();
  await Promise.all(
    Array.from(usersByToday.entries()).map(async ([today, userIds]) => {
      const { data } = await supabase
        .from("daily_quest_logs")
        .select("user_id")
        .in("user_id", userIds)
        .eq("quest_date", today);
      for (const row of (data ?? []) as any[]) usersWithQuestLogToday.add(row.user_id);
    })
  );

  for (const [userId, userInfo] of Array.from(usersToProcess.entries())) {
    const { timezone, notificationHour, streakDays, lastActiveDate, lastNotificationSentDate, xpTotal, currencyCode } = userInfo;
    const localHour = currentHourInTZ(timezone);
    const today     = todayInTZ(timezone);

    // ── Daily-cron gating (Vercel Hobby: cron runs at most once/day) ──
    // Sprint 11 Phase 5: this is now a call to the extracted pure function
    // shouldNotifyUserNow() (see above), unit tested directly. Behavior
    // is unchanged from the inline version migration 017 introduced —
    // see that function's docstring for the full "why" (Vercel Hobby
    // once-daily cron + per-user timezone + overdue fallback).
    if (!shouldNotifyUserNow({
      today,
      localHour,
      notificationHour,
      lastNotificationSentDate,
      yesterdayInTZ: todayInTZ(timezone, -1),
    })) {
      continue;
    }

    processed++;
    // Sprint 27, Phase 8: atomic claim, not an unconditional mark — see
    // tryClaimDailyNotificationSlot()'s own docstring for the race this
    // closes. Losing the claim (another invocation already claimed this
    // user's slot for today) is not an error; it just means this run has
    // nothing to do for them.
    const claimed = await tryClaimDailyNotificationSlot(userId, today);
    if (!claimed) continue;

    // Sprint 27, Phase 8: everything from here down runs inside a
    // per-user try/catch. Before this phase, an exception thrown while
    // processing ANY single user (a malformed row, a transient query
    // failure on one of the several fetches below, etc.) would propagate
    // out of the for-loop entirely and abort processing for every
    // subsequent user in usersToProcess — not just skip that one person.
    // Given this loop can process thousands of users in one run, that's a
    // large blast radius for one bad row. The atomic claim above already
    // happened, so a user whose processing throws here does NOT get
    // silently skipped forever either — tomorrow's run still catches them
    // via shouldNotifyUserNow()'s "overdue" fallback, same as any other
    // day they weren't reached.
    try {

    // Sprint 27, Phase 4: quiet hours. Checked right after the daily-cron
    // gate above and before any of the checks below — same "mark
    // processed, then decide what (if anything) to actually send" shape
    // the inactive-user early-continue already uses, so a quiet-hours user
    // still counts as "processed" for this run's stats without receiving
    // anything.
    if (isUserInQuietHours(userId, localHour)) {
      continue;
    }

    const daysSinceActive = lastActiveDate
      ? Math.floor((new Date(today).getTime() - new Date(lastActiveDate).getTime()) / 86400000)
      : 999;

    // 1. Inactive 3+ days
    // Sprint 16: deliberately NOT gated by any of the six new preference
    // categories — "come back, we miss you" doesn't map cleanly to
    // achievements/goals/streaks/summaries/milestones/announcements, and
    // forcing it under one would misrepresent what that toggle controls.
    // It remains governed only by the existing master notifications_enabled
    // switch (already applied in the query above).
    if (daysSinceActive >= 3) {
      const r = await sendInactiveReminder(userId, daysSinceActive);
      notifications_sent += r.sent; errors += r.errors;
      continue; // don't spam with other notifications
    }

    // 2. Streak at risk (active yesterday but not today)
    // Sprint 16 — gated by the streak_reminders preference. Kept as an
    // early boolean check rather than skipping the whole block, so the
    // existing daysSinceActive/streakDays logic above stays untouched.
    if (streakDays > 0 && daysSinceActive === 1 && getPref(userId, "streak_reminders")) {
      const r = await sendStreakAtRisk(userId, streakDays);
      notifications_sent += r.sent; errors += r.errors;
    }

    // 3. Daily quest not yet completed
    const questLog = usersWithQuestLogToday.has(userId);

    const userGoals = goalsByUser.get(userId) ?? [];
    const nearestGoal = pickNearestGoal(userGoals);

    if (!questLog && getPref(userId, "goal_reminders")) {
      const xpLevel = getLevelFromXP(xpTotal);
      const level: ReminderLevelSnapshot = {
        level: xpLevel.level,
        xpTotal,
        currentLevelXP: xpLevel.currentLevelXP,
        nextLevelXP: xpLevel.nextLevelXP,
      };
      const r = await sendDailyQuestReminder(userId, { nearestGoal, level, currencyCode });
      notifications_sent += r.sent; errors += r.errors;
    }

    // 4. Weekly quest nearing expiry (1-2 days left in the week)
    const daysLeftInWeek = getDaysRemainingInWeek();
    if (daysLeftInWeek <= 2) {
      // Check user_weekly_quests — the actual table for weekly quest state
      const { data: weeklyQuest } = await supabase
        .from("user_weekly_quests")
        .select("id, status")
        .eq("user_id", userId)
        .eq("status", "active")             // active = accepted but not yet completed
        .eq("week_start", getWeekStart())
        .limit(1)
        .maybeSingle();

      if (weeklyQuest && getPref(userId, "goal_reminders")) {
        // They have an incomplete weekly quest this week — remind them
        const r = await sendWeeklyQuestExpiry(userId, daysLeftInWeek);
        notifications_sent += r.sent; errors += r.errors;
      }
    }

    // 5. Seasonal challenge nearing expiry (≤3 days)
    const { data: activeChallengesFull } = await supabase
      .from("user_challenges")
      .select("started_at, challenges!inner(title, duration_days)")
      .eq("user_id", userId)
      .eq("status", "active") as any;

    if (activeChallengesFull) {
      for (const uc of activeChallengesFull) {
        const ch = uc.challenges;
        const expiresAt = new Date(uc.started_at);
        expiresAt.setDate(expiresAt.getDate() + ch.duration_days);
        const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / 86400000);
        if (daysLeft >= 1 && daysLeft <= 3 && getPref(userId, "goal_reminders")) {
          const r = await sendSeasonalExpiry(userId, ch.title, daysLeft);
          notifications_sent += r.sent; errors += r.errors;
        }
      }
    }

    // 6. Goal almost complete (>=90% funded, not yet done) — Sprint 27
    // Phase 3. Per-user dedupe over 14 days (see the query above for why
    // not per-goal). Gated by goal_reminders, same as checks 3-5.
    if (
      nearestGoal &&
      shouldSendGoalAlmostComplete(nearestGoal) &&
      getPref(userId, "goal_reminders") &&
      !recentlyRemindedAlmostComplete.has(userId)
    ) {
      const r = await sendGoalAlmostComplete(userId, nearestGoal, currencyCode);
      notifications_sent += r.sent; errors += r.errors;
    }

    // 7. Goal deadline approaching (within 3 days, incomplete) — Sprint
    // 27 Phase 3. Deliberately no extra dedupe beyond the once-per-day
    // cron gate above — same "fires daily as the deadline nears" behavior
    // already established by weekly_expiry/seasonal_expiry (checks 4-5).
    if (nearestGoal && getPref(userId, "goal_reminders")) {
      const daysLeft = goalDaysRemaining(nearestGoal);
      if (daysLeft !== null && shouldSendGoalDeadlineApproaching(nearestGoal)) {
        const r = await sendGoalDeadlineApproaching(userId, nearestGoal, daysLeft, currencyCode);
        notifications_sent += r.sent; errors += r.errors;
      }
    }

    // 8. Missed weekly deposit (no deposit logged this week, ≤2 days left
    // in the week) — Sprint 27 Phase 3. Only fires for users who have at
    // least one active goal, so it's never a content-free nag.
    if (
      nearestGoal &&
      daysLeftInWeek <= 2 &&
      (weekDepositTotalByUser.get(userId) ?? 0) <= 0 &&
      getPref(userId, "goal_reminders")
    ) {
      const r = await sendMissedWeeklyDeposit(userId, nearestGoal, currencyCode);
      notifications_sent += r.sent; errors += r.errors;
    }
    } catch (err) {
      console.error(`[daily-scheduler] Failed processing user ${userId}:`, err);
      errors++;
    }
  }

  return { processed, notifications_sent, errors };
}

// ── Sprint 22, Phase 4: accountability partners ─────────────────────────────
//
// Sprint 27, Phase 4 update: now gated by the "partners" notification_
// preferences category (see 20260723_notification_preferences_expansion.sql)
// instead of only the global switch — canSendNotificationToUser() checks
// both. This closes the exact gap this comment used to describe.

async function notificationsGloballyEnabled(userId: string): Promise<boolean> {
  const supabase = createServiceClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("notifications_enabled")
    .eq("id", userId)
    .maybeSingle();
  return profile?.notifications_enabled ?? true;
}

/** Fires when someone sends a partner request. Called from /api/partner/request. */
export async function sendPartnerRequest(
  userId: string,
  requesterDisplayName: string
): Promise<{ sent: number; errors: number }> {
  if (!(await canSendNotificationToUser(userId, "partners"))) return { sent: 0, errors: 0 };

  const { title, body } = renderNotificationTemplate("partner_request", { display_name: requesterDisplayName });
  return sendToUser(userId, "partner_request", title, body, "/partner");
}

/** Fires when a partner request is accepted. Called from /api/partner/respond. */
export async function sendPartnerAccepted(
  userId: string,
  partnerDisplayName: string
): Promise<{ sent: number; errors: number }> {
  if (!(await canSendNotificationToUser(userId, "partners"))) return { sent: 0, errors: 0 };

  const { title, body } = renderNotificationTemplate("partner_accepted", { display_name: partnerDisplayName });
  return sendToUser(userId, "partner_accepted", title, body, "/partner");
}

/**
 * Fires when a user nudges their accountability partner. Called from
 * /api/partner/nudge, which rate-limits the sender — this function itself
 * doesn't, since it has no way to distinguish one legitimate nudge from a
 * burst of them.
 */
export async function sendPartnerNudge(
  userId: string,
  senderDisplayName: string,
  message?: string
): Promise<{ sent: number; errors: number }> {
  if (!(await canSendNotificationToUser(userId, "partners"))) return { sent: 0, errors: 0 };

  const { title, body: fallbackBody } = renderNotificationTemplate("partner_nudge", { display_name: senderDisplayName });
  return sendToUser(userId, "partner_nudge", title, message?.slice(0, 120) || fallbackBody, "/partner");
}

// ── Sprint 22, Phase 11 continuation ────────────────────────────────────────
//
// Sprint 27, Phase 4 update: group_invite and goal_invitation now gate on
// the new "groups" category (goal_invitation is a shared/collaborative-
// goal invite — closer in spirit to a group action than to the "goal_
// reminders" category, which is specifically about reminder nudges, not
// social invites). partner_reminder now gates on "partners", same as the
// four partner_* senders above.
//
// friend_request / friend_accepted deliberately stay on the global switch
// only — "Social/Friends" isn't one of the categories this phase's brief
// asked for (Goals, Groups, Partners, Achievements, XP, Referrals,
// Marketing, Weekly/Monthly summaries), so no category was invented for
// it rather than overreaching past what was actually requested.
//
// group_quest_completed and group_weekly_summary DO reuse existing
// categories (milestone_celebrations and weekly_summaries respectively) —
// both existed in 039_notification_preferences.sql with real, persisted
// toggles but no send path anywhere in the codebase until Sprint 27 Phase
// 3 (see that migration's own honesty note). Left as-is here, not moved
// onto "groups", to avoid silently changing behavior for a toggle users
// may have already set.

export async function sendFriendRequest(
  userId: string,
  requesterDisplayName: string
): Promise<{ sent: number; errors: number }> {
  if (!(await notificationsGloballyEnabled(userId))) return { sent: 0, errors: 0 };

  const { title, body } = renderNotificationTemplate("friend_request", { display_name: requesterDisplayName });
  return sendToUser(userId, "friend_request", title, body, "/friends");
}

export async function sendFriendAccepted(
  userId: string,
  accepterDisplayName: string
): Promise<{ sent: number; errors: number }> {
  if (!(await notificationsGloballyEnabled(userId))) return { sent: 0, errors: 0 };

  const { title, body } = renderNotificationTemplate("friend_accepted", { display_name: accepterDisplayName });
  return sendToUser(userId, "friend_accepted", title, body, "/friends");
}

export async function sendGroupInvite(
  userId: string,
  inviterDisplayName: string,
  groupName: string,
  groupId: string
): Promise<{ sent: number; errors: number }> {
  if (!(await canSendNotificationToUser(userId, "groups"))) return { sent: 0, errors: 0 };

  const { title, body } = renderNotificationTemplate("group_invite", { display_name: inviterDisplayName, group_name: groupName });
  return sendToUser(userId, "group_invite", title, body, `/groups/${groupId}`);
}

export async function sendGoalInvitation(
  userId: string,
  inviterDisplayName: string,
  goalTitle: string,
  sharedGoalId: string
): Promise<{ sent: number; errors: number }> {
  if (!(await canSendNotificationToUser(userId, "groups"))) return { sent: 0, errors: 0 };

  const { title, body } = renderNotificationTemplate("goal_invitation", { display_name: inviterDisplayName, goal_name: goalTitle });
  return sendToUser(userId, "goal_invitation", title, body, `/shared-goals/${sharedGoalId}`);
}

/** Fires for every currently-active member when a group quest completes
 *  (app/api/group-quests/check-completion/route.ts, after a successful
 *  public.service_complete_group_quest() call, 050) — reuses the
 *  milestone_celebrations preference, same framing as an individual goal
 *  completion celebration. */
export async function sendGroupQuestCompleted(
  userId: string,
  groupId: string | null | undefined,
  groupName: string,
  questTitle: string
): Promise<{ sent: number; errors: number }> {
  const allowed = await canSendNotificationToUser(userId, "milestone_celebrations");
  if (!allowed) return { sent: 0, errors: 0 };

  const { title, body } = renderNotificationTemplate("group_quest_completed", { group_name: groupName, quest_title: questTitle });
  return sendToUser(userId, "group_quest_completed", title, body, groupId ? `/groups/${groupId}` : "/groups");
}

async function sendPartnerReminder(userId: string): Promise<{ sent: number; errors: number }> {
  if (!(await canSendNotificationToUser(userId, "partners"))) return { sent: 0, errors: 0 };

  const { title, body } = renderNotificationTemplate("partner_reminder", {});
  return sendToUser(userId, "partner_reminder", title, body, "/partner");
}

/**
 * Reminds both sides of a quiet accountability partnership. Runs from the
 * SAME once-daily cron invocation as everything else here (not gated to
 * Monday like the two weekly schedulers below — a partnership going quiet
 * is worth catching sooner than a week later), piggybacking rather than
 * requesting a new Vercel Cron slot, same reasoning as
 * runWeeklySummaryScheduler().
 *
 * "Quiet" = neither party has nudged the other (activity_feed has no
 * direct signal for this — nudges aren't feed events — so this reads
 * notification_logs for the most recent partner_nudge either direction)
 * in the last 5 days, AND a reminder hasn't already been sent to this
 * user in the last 7 days (checked the same way — no new schema needed
 * for either check, both reuse notification_logs as the source of truth
 * for "when did we last do X", avoiding a dedicated last_reminder_at
 * column for what's a fairly minor feature).
 */
export async function runPartnerReminderScheduler(): Promise<{ processed: number; notifications_sent: number; errors: number }> {
  const supabase = createServiceClient();

  const { data: partnerships, error } = await supabase
    .from("accountability_partners")
    .select("id, requester_id, partner_id")
    .eq("status", "active");

  if (error || !partnerships) {
    console.error("[partner-reminder] Failed to fetch active partnerships:", error);
    return { processed: 0, notifications_sent: 0, errors: 1 };
  }
  if (partnerships.length === 0) {
    return { processed: 0, notifications_sent: 0, errors: 0 };
  }

  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Sprint 22, Phase 13: batched to two queries total, regardless of how
  // many partnerships exist — the original shape (see 055's audit
  // findings) issued up to 3 separate round trips PER partnership (one
  // nudge check, one reminder check per member), which scales linearly
  // with partnership count for no reason: every relevant row for every
  // partnership can be fetched in one shot and matched up in memory.
  // Sprint 27, Phase 8: now backed by the shared getRecentlyNotifiedUserIds()
  // helper instead of two bespoke inline queries with the same shape.
  const allUserIds = Array.from(new Set((partnerships as any[]).flatMap((p) => [p.requester_id, p.partner_id])));

  const recentlyNudgedUserIds = await getRecentlyNotifiedUserIds(allUserIds, "partner_nudge", fiveDaysAgo);
  const recentlyRemindedUserIds = await getRecentlyNotifiedUserIds(allUserIds, "partner_reminder", sevenDaysAgo);

  let notifications_sent = 0, errors = 0;

  for (const p of partnerships as any[]) {
    const pair = [p.requester_id, p.partner_id];

    // A nudge from EITHER side counts for the pair — same "still active,
    // leave them alone" semantics as the original per-partnership query.
    if (pair.some((uid) => recentlyNudgedUserIds.has(uid))) continue;

    for (const userId of pair) {
      if (recentlyRemindedUserIds.has(userId)) continue;

      try {
        const r = await sendPartnerReminder(userId);
        notifications_sent += r.sent;
        errors += r.errors;
      } catch (err) {
        console.error("[partner-reminder] Send failed:", err);
        errors += 1;
      }
    }
  }

  return { processed: partnerships.length, notifications_sent, errors };
}

async function sendGroupWeeklySummary(
  userId: string,
  groupId: string,
  groupName: string,
  xpEarned: number,
  questsCompleted: number,
  activeMembers: number
): Promise<{ sent: number; errors: number }> {
  const allowed = await canSendNotificationToUser(userId, "weekly_summaries");
  if (!allowed) return { sent: 0, errors: 0 };

  const { title, body } = renderNotificationTemplate(
    questsCompleted > 0 ? "group_weekly_summary_with_quests" : "group_weekly_summary_no_quests",
    {
      group_name: groupName,
      xp: xpEarned,
      active_members: activeMembers,
      member_word: activeMembers === 1 ? "saver" : "savers",
      quests: questsCompleted,
      quest_word: questsCompleted === 1 ? "quest" : "quests",
    }
  );
  return sendToUser(userId, "group_weekly_summary", title, body, `/groups/${groupId}`);
}

/**
 * Weekly group digest — Monday only, same day-of-week gate and same
 * reasoning as runWeeklySummaryScheduler() above (reuse the existing
 * daily cron slot rather than requesting a new one). Deliberately
 * non-monetary: group XP earned and quest completions, never a dollar
 * total — same conservative "never expose financial balances" reading
 * this sprint has applied consistently to every group-facing broadcast
 * surface (leaderboards, group contribution counts).
 */
export async function runGroupWeeklySummaryScheduler(): Promise<{ processed: number; notifications_sent: number; errors: number }> {
  const supabase = createServiceClient();

  const { data: groups, error } = await supabase.from("groups").select("id, name").eq("is_active", true);
  if (error || !groups) {
    console.error("[group-weekly-summary] Failed to fetch groups:", error);
    return { processed: 0, notifications_sent: 0, errors: 1 };
  }
  if (groups.length === 0) {
    return { processed: 0, notifications_sent: 0, errors: 0 };
  }

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const groupIds = (groups as any[]).map((g) => g.id);

  // Sprint 22, Phase 13: batched to two queries total (members, quests)
  // regardless of how many active groups exist, instead of two queries
  // PER group — same reasoning as runPartnerReminderScheduler above.
  const { data: allMembers } = await supabase
    .from("group_members")
    .select("group_id, user_id")
    .in("group_id", groupIds)
    .eq("status", "active");

  const { data: allQuestRows } = await supabase
    .from("group_quests")
    .select("group_id, xp_reward")
    .in("group_id", groupIds)
    .eq("status", "completed")
    .gte("completed_at", oneWeekAgo);

  const membersByGroup = new Map<string, string[]>();
  for (const m of (allMembers ?? []) as any[]) {
    if (!membersByGroup.has(m.group_id)) membersByGroup.set(m.group_id, []);
    membersByGroup.get(m.group_id)!.push(m.user_id);
  }

  const questStatsByGroup = new Map<string, { xpEarned: number; questsCompleted: number }>();
  for (const q of (allQuestRows ?? []) as any[]) {
    const existing = questStatsByGroup.get(q.group_id) ?? { xpEarned: 0, questsCompleted: 0 };
    existing.xpEarned += q.xp_reward ?? 0;
    existing.questsCompleted += 1;
    questStatsByGroup.set(q.group_id, existing);
  }

  let notifications_sent = 0, errors = 0;
  const allMemberIdsFlat = Array.from(new Set((allMembers ?? []).map((m: any) => m.user_id)));
  // Sprint 27, Phase 8: same rolling-window dedup reasoning as
  // runWeeklySummaryScheduler() above — guards a double-invoked Monday
  // cron from sending every group member two copies.
  const alreadyNotifiedThisPeriod = await getRecentlyNotifiedUserIds(
    allMemberIdsFlat, "group_weekly_summary", oneWeekAgo
  );

  for (const group of groups as any[]) {
    const memberIds = membersByGroup.get(group.id) ?? [];
    if (memberIds.length === 0) continue;

    // Each active member receives the full xp_reward per completed group
    // quest (050's service_complete_group_quest — not divided between
    // members), so a member's total group-quest XP this week is simply
    // the sum of xp_reward across this week's completed quests. Reading
    // this straight from group_quests.xp_reward instead of re-deriving it
    // from xp_awards avoids an easy mistake: xp_awards would have one row
    // PER MEMBER per quest, not one per quest, so naively summing that
    // table here would overcount by a factor of the member count.
    const { xpEarned, questsCompleted } = questStatsByGroup.get(group.id) ?? { xpEarned: 0, questsCompleted: 0 };

    if (xpEarned === 0 && questsCompleted === 0) continue; // quiet week, nothing to report

    for (const userId of memberIds) {
      if (alreadyNotifiedThisPeriod.has(userId)) continue;
      try {
        const r = await sendGroupWeeklySummary(userId, group.id, group.name, xpEarned, questsCompleted, memberIds.length);
        notifications_sent += r.sent;
        errors += r.errors;
      } catch (err) {
        console.error("[group-weekly-summary] Send failed:", err);
        errors += 1;
      }
    }
  }

  return { processed: groups.length, notifications_sent, errors };
}

// ── Sprint 27, Phase 3: group quest ending soon ─────────────────────────────
//
// Group-scoped (one quest → many members), so it can't reuse the per-user
// loop in runDailyNotificationScheduler() the way goal_almost_complete /
// goal_deadline_approaching / missed_weekly_deposit do. Follows the exact
// batching shape of runGroupWeeklySummaryScheduler() above instead: one
// query for the quests, one for their members, one for recent logs — no
// query-per-group or query-per-member regardless of how many active
// group quests exist. Gated by the "groups" notification_preferences
// category, added in Sprint 27 Phase 4 (was global-switch-only when this
// scheduler first shipped in Phase 3 — updated below once the category
// existed, rather than left stale).
export async function runGroupQuestEndingReminderScheduler(): Promise<{ processed: number; notifications_sent: number; errors: number }> {
  const supabase = createServiceClient();

  const today = new Date().toISOString().slice(0, 10);
  const twoDaysOut = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);

  const { data: quests, error } = await supabase
    .from("group_quests")
    .select("id, group_id, title, end_date, groups!inner(id, name, is_active)")
    .eq("status", "active")
    .gte("end_date", today)
    .lte("end_date", twoDaysOut);

  if (error || !quests) {
    console.error("[group-quest-ending] Failed to fetch ending group quests:", error);
    return { processed: 0, notifications_sent: 0, errors: 1 };
  }

  const activeQuests = (quests as any[]).filter((q) => q.groups?.is_active);
  if (activeQuests.length === 0) {
    return { processed: 0, notifications_sent: 0, errors: 0 };
  }

  const groupIds = Array.from(new Set(activeQuests.map((q) => q.group_id)));
  const { data: allMembers } = await supabase
    .from("group_members")
    .select("group_id, user_id")
    .in("group_id", groupIds)
    .eq("status", "active");

  const membersByGroup = new Map<string, string[]>();
  for (const m of (allMembers ?? []) as any[]) {
    if (!membersByGroup.has(m.group_id)) membersByGroup.set(m.group_id, []);
    membersByGroup.get(m.group_id)!.push(m.user_id);
  }

  // Dedupe against double-invocation of the same cron run on the same
  // day (not against firing again tomorrow as the deadline gets closer —
  // that daily-repeat behavior is intentional, same as weekly_expiry /
  // seasonal_expiry in the main scheduler).
  const allMemberIds = Array.from(new Set((allMembers ?? []).map((m: any) => m.user_id)));
  const startOfToday = new Date(`${today}T00:00:00.000Z`).toISOString();
  const alreadyNotifiedToday = await getRecentlyNotifiedUserIds(allMemberIds, "group_quest_ending", startOfToday);

  let notifications_sent = 0, errors = 0;

  for (const quest of activeQuests) {
    const memberIds = membersByGroup.get(quest.group_id) ?? [];
    if (memberIds.length === 0) continue;

    const daysLeft = Math.max(
      0,
      Math.round((new Date(`${quest.end_date}T00:00:00.000Z`).getTime() - Date.now()) / 86400000)
    );

    for (const userId of memberIds) {
      if (alreadyNotifiedToday.has(userId)) continue;
      try {
        const allowed = await canSendNotificationToUser(userId, "groups");
        if (!allowed) continue;
        const r = await sendGroupQuestEnding(userId, quest.group_id, quest.groups.name, quest.title, daysLeft);
        notifications_sent += r.sent;
        errors += r.errors;
      } catch (err) {
        console.error("[group-quest-ending] Send failed:", err);
        errors += 1;
      }
    }
  }

  return { processed: activeQuests.length, notifications_sent, errors };
}

// ── Sprint 27, Phase 13: notification data retention / cleanup ─────────────
//
// notification_logs has never had a retention policy — every notification
// this app has ever sent, to every user, stays in this table forever.
// push_subscriptions has the analogous gap for deactivated subscriptions
// (see deactivateSubscription()'s own comment). However well-indexed
// (see 20260726_notification_performance_indexes.sql), every query
// against a table gets slower as it grows without bound, and it's pure
// wasted storage past a point. Three different retention windows,
// because these are genuinely different kinds of "old":
//
//   1. Soft-deleted notification_logs rows (deleted_at set) — a user
//      explicitly asked for these to be gone (the Notification Center's
//      delete action). Kept for SOFT_DELETE_RETENTION_DAYS as a grace
//      period (undo-adjacent safety, support debugging) then
//      hard-deleted — there's no product reason to keep something a
//      user deleted forever.
//   2. Everything else in notification_logs — kept for
//      HARD_RETENTION_DAYS regardless of deleted_at, long enough to
//      cover Phase 11's analytics dashboards (which report all-time
//      totals today, but a ~6-month window is generous for any read of
//      "recent trends") while still bounding total table growth.
//   3. Deactivated push_subscriptions — kept for
//      INACTIVE_SUBSCRIPTION_RETENTION_DAYS after their last update
//      (now correctly maintained — see deactivateSubscription()) in
//      case a "gone" signal was ever a transient false positive worth
//      investigating, then purged.
//
// Gated to run weekly (Sundays — see the cron route), not daily: this is
// housekeeping, not a time-sensitive job, and running a DELETE across a
// potentially large table more often than needed is exactly the kind of
// unnecessary work a performance-focused phase should avoid adding.
const SOFT_DELETE_RETENTION_DAYS = 30;
const HARD_RETENTION_DAYS = 180;
const INACTIVE_SUBSCRIPTION_RETENTION_DAYS = 90;

export async function runNotificationLogsCleanupScheduler(): Promise<{
  deletedSoftDeleted: number;
  deletedExpired: number;
  deletedInactiveSubscriptions: number;
  errors: number;
}> {
  const supabase = createServiceClient();
  let deletedSoftDeleted = 0;
  let deletedExpired = 0;
  let deletedInactiveSubscriptions = 0;
  let errors = 0;

  const softDeleteCutoff = new Date(Date.now() - SOFT_DELETE_RETENTION_DAYS * 86400000).toISOString();
  const hardCutoff = new Date(Date.now() - HARD_RETENTION_DAYS * 86400000).toISOString();

  try {
    const { error, count } = await supabase
      .from("notification_logs")
      .delete({ count: "exact" })
      .not("deleted_at", "is", null)
      .lt("deleted_at", softDeleteCutoff);
    if (error) throw error;
    deletedSoftDeleted = count ?? 0;
  } catch (err) {
    console.error("[notification-cleanup] Soft-delete purge failed:", err);
    errors++;
  }

  // Separate try/catch from the purge above — a failure in one must not
  // skip the other; they're independent maintenance operations, same
  // "one failure shouldn't cascade" reasoning Phase 8 applied to
  // per-user loop isolation, applied here to per-operation isolation.
  try {
    const { error, count } = await supabase
      .from("notification_logs")
      .delete({ count: "exact" })
      .lt("sent_at", hardCutoff);
    if (error) throw error;
    deletedExpired = count ?? 0;
  } catch (err) {
    console.error("[notification-cleanup] Hard-retention purge failed:", err);
    errors++;
  }

  // Sprint 27, Phase 13: push_subscriptions has the same "deactivated
  // but never actually removed" gap notification_logs had — sendToUser()
  // (via deactivateSubscription()) sets is_active = false on a permanent
  // delivery failure (410/404 "gone") but nothing ever deleted these
  // rows. The partial index on is_active=true (20260613_notifications.sql)
  // already keeps the hot "find active subscriptions" query fast
  // regardless, so this is a storage/table-bloat cleanup, not a query-
  // latency fix — still real, still worth doing now that
  // deactivateSubscription() actually maintains updated_at correctly
  // (fixed alongside this in the same phase — see that function's comment).
  try {
    const subscriptionCutoff = new Date(Date.now() - INACTIVE_SUBSCRIPTION_RETENTION_DAYS * 86400000).toISOString();
    const { error, count } = await supabase
      .from("push_subscriptions")
      .delete({ count: "exact" })
      .eq("is_active", false)
      .lt("updated_at", subscriptionCutoff);
    if (error) throw error;
    deletedInactiveSubscriptions = count ?? 0;
  } catch (err) {
    console.error("[notification-cleanup] Inactive subscription purge failed:", err);
    errors++;
  }

  return { deletedSoftDeleted, deletedExpired, deletedInactiveSubscriptions, errors };
}