/**
 * lib/notifications.ts
 * Core notification dispatch logic — used by cron job and manual triggers.
 */

import { createServiceClient } from "./supabase/server";
import { sendWebPush, type SendResult } from "./webpush";
import type { NotificationType, PushPayload, PushSubscriptionRow } from "./types.notifications";
import { getDaysRemainingInWeek } from "./weeklyQuests";
import { formatAmount } from "./currency";

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
  body: string
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
    })
    .select("id")
    .single();

  if (error) console.error("[notifications] Failed to create log row:", error);
  return data?.id ?? "";
}

/** Record the send result (error, if any) on an existing log row. */
async function updateLogResult(logId: string, result: SendResult): Promise<void> {
  if (!logId) return;
  const supabase = createServiceClient();
  await supabase
    .from("notification_logs")
    .update({ error: result.ok ? null : (result.error ?? `HTTP ${result.status}`) })
    .eq("id", logId);
}

async function deactivateSubscription(endpoint: string) {
  const supabase = createServiceClient();
  await supabase
    .from("push_subscriptions")
    .update({ is_active: false })
    .eq("endpoint", endpoint);
}

/** Record that a user was sent a scheduled notification "today" (their local date). */
async function markNotifiedToday(userId: string, localDate: string): Promise<void> {
  const supabase = createServiceClient();
  await supabase
    .from("profiles")
    .update({ last_notification_sent_date: localDate })
    .eq("id", userId);
}

// ── Send to one user ─────────────────────────────────────────────────────────

async function sendToUser(
  userId: string,
  type: NotificationType,
  title: string,
  body: string,
  url = "/dashboard"
): Promise<{ sent: number; errors: number }> {
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
  const logId = await createPendingLog(userId, null, type, title, body);

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

    const result = await sendWebPush(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
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
  return sendToUser(
    userId,
    "streak_at_risk",
    `🔥 Your ${streakDays}-day streak is at risk!`,
    "Log a saving or check in before midnight to keep your streak alive.",
    "/dashboard"
  );
}

export async function sendDailyQuestReminder(userId: string) {
  return sendToUser(
    userId,
    "daily_quest",
    "📋 Daily quest waiting for you!",
    "You haven't completed today's quest yet. Finish it to earn XP.",
    "/quests"
  );
}

export async function sendWeeklyQuestExpiry(userId: string, daysLeft: number) {
  return sendToUser(
    userId,
    "weekly_expiry",
    `⏰ Weekly quest expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
    "Don't let your weekly quest expire — complete it before Sunday!",
    "/quests"
  );
}

export async function sendSeasonalExpiry(userId: string, title: string, daysLeft: number) {
  return sendToUser(
    userId,
    "seasonal_expiry",
    `⚡ "${title}" ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
    "Complete this seasonal challenge before it expires to earn bonus XP.",
    "/quests"
  );
}

export async function sendInactiveReminder(userId: string, daysSinceActive: number) {
  return sendToUser(
    userId,
    "inactive",
    "👋 We miss you at SaveQuest!",
    `It's been ${daysSinceActive} days since your last saving. Your goals are waiting.`,
    "/dashboard"
  );
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
  category: "achievements" | "milestone_celebrations" | "weekly_summaries"
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
  achievementIcon: string
): Promise<{ sent: number; errors: number }> {
  const allowed = await canSendNotificationToUser(userId, "achievements");
  if (!allowed) return { sent: 0, errors: 0 };

  return sendToUser(
    userId,
    "achievement_unlocked",
    `${achievementIcon} Achievement unlocked: ${achievementTitle}`,
    "Tap to see your badge collection.",
    "/profile"
  );
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
  goalTitle: string
): Promise<{ sent: number; errors: number }> {
  const allowed = await canSendNotificationToUser(userId, "milestone_celebrations");
  if (!allowed) return { sent: 0, errors: 0 };

  return sendToUser(
    userId,
    "milestone_celebration",
    `🎉 Goal complete: ${goalTitle}!`,
    "You did it — check out your progress and start your next goal.",
    "/goals"
  );
}

/**
 * Weekly savings recap — reuses the existing daily cron trigger rather
 * than requesting a new Vercel Cron schedule slot; runWeeklySummaryScheduler()
 * is called from app/api/cron/notifications/route.ts but internally no-ops
 * on every day except Monday. This keeps the "one new cron entry per
 * feature" footprint at zero for this addition.
 */
export async function runWeeklySummaryScheduler(): Promise<{ processed: number; notifications_sent: number; errors: number }> {
  const supabase = createServiceClient();

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, currency_code")
    .eq("notifications_enabled", true);

  if (error || !profiles) {
    console.error("[weekly-summary] Failed to fetch profiles:", error);
    return { processed: 0, notifications_sent: 0, errors: 1 };
  }

  let notifications_sent = 0, errors = 0;
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  for (const { id: userId, currency_code } of profiles as any[]) {
    const allowed = await canSendNotificationToUser(userId, "weekly_summaries");
    if (!allowed) continue;

    const { data: deposits } = await supabase
      .from("transactions")
      .select("amount")
      .eq("user_id", userId)
      .eq("transaction_type", "deposit")
      .gte("created_at", oneWeekAgo);

    const totalSaved = (deposits ?? []).reduce((sum, t: any) => sum + Number(t.amount), 0);

    // Skip the recap entirely for a user who saved nothing this week —
    // "you saved $0 this week" is not a motivational message, it's a
    // discouraging one, and this app's own notification philosophy
    // elsewhere (streak-at-risk, inactive reminders) is about prompting
    // action, not reporting a null result.
    if (totalSaved <= 0) continue;

    const r = await sendWeeklySummary(userId, totalSaved, currency_code);
    notifications_sent += r.sent;
    errors += r.errors;
  }

  return { processed: profiles.length, notifications_sent, errors };
}

async function sendWeeklySummary(userId: string, totalSaved: number, currencyCode: string): Promise<{ sent: number; errors: number }> {
  return sendToUser(
    userId,
    "weekly_summary",
    `📊 You saved ${formatAmount(totalSaved, currencyCode)} this week!`,
    "See your full weekly breakdown and keep the momentum going.",
    "/dashboard"
  );
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
        last_notification_sent_date, notifications_enabled
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
    .select("user_id, goal_reminders, streak_reminders")
    .in("user_id", userIds);

  const prefsByUser = new Map<string, { goal_reminders: boolean; streak_reminders: boolean }>();
  for (const row of prefRows ?? []) {
    prefsByUser.set(row.user_id, {
      goal_reminders: row.goal_reminders,
      streak_reminders: row.streak_reminders,
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

  // Deduplicate by user_id (one user may have multiple subscriptions)
  const usersToProcess = new Map<string, {
    timezone: string;
    notificationHour: number;
    streakDays: number;
    lastActiveDate: string | null;
    lastNotificationSentDate: string | null;
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
    });
  }

  for (const [userId, userInfo] of Array.from(usersToProcess.entries())) {
    const { timezone, notificationHour, streakDays, lastActiveDate, lastNotificationSentDate } = userInfo;
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
    // Mark immediately (covers the early `continue` below for inactive
    // users too) so a second cron invocation the same day is a no-op.
    await markNotifiedToday(userId, today);

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
    const { data: questLog } = await supabase
      .from("daily_quest_logs")
      .select("id")
      .eq("user_id", userId)
      .eq("quest_date", today)
      .limit(1)
      .maybeSingle();

    if (!questLog && getPref(userId, "goal_reminders")) {
      const r = await sendDailyQuestReminder(userId);
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
  }

  return { processed, notifications_sent, errors };
}

function getWeekStart(): string {
  const d   = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  return monday.toISOString().split("T")[0];
}

// ── Sprint 22, Phase 4: accountability partners ─────────────────────────────
//
// No notification_preferences category exists for these (see the
// NotificationType comment in lib/types.notifications.ts) — gated only by
// the global profiles.notifications_enabled switch, same fallback
// canSendNotificationToUser() uses for any type without a specific
// category. A dedicated "partner_updates" category is Phase 11 scope.

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
  if (!(await notificationsGloballyEnabled(userId))) return { sent: 0, errors: 0 };

  return sendToUser(
    userId,
    "partner_request",
    `🤝 ${requesterDisplayName} wants to be your accountability partner`,
    "Tap to accept or decline.",
    "/partner"
  );
}

/** Fires when a partner request is accepted. Called from /api/partner/respond. */
export async function sendPartnerAccepted(
  userId: string,
  partnerDisplayName: string
): Promise<{ sent: number; errors: number }> {
  if (!(await notificationsGloballyEnabled(userId))) return { sent: 0, errors: 0 };

  return sendToUser(
    userId,
    "partner_accepted",
    `🎉 ${partnerDisplayName} accepted your partner request`,
    "You're now accountability partners. Tap to see their progress.",
    "/partner"
  );
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
  if (!(await notificationsGloballyEnabled(userId))) return { sent: 0, errors: 0 };

  return sendToUser(
    userId,
    "partner_nudge",
    `👋 ${senderDisplayName} sent you a nudge`,
    message?.slice(0, 120) || "Keep going — your partner is cheering you on!",
    "/partner"
  );
}

// ── Sprint 22, Phase 11 continuation ────────────────────────────────────────
//
// friend_request / friend_accepted / group_invite / goal_invitation /
// partner_reminder have no dedicated notification_preferences category —
// same honest gap as the Phase 4 partner_* types above, gated only by the
// global profiles.notifications_enabled switch. group_quest_completed and
// group_weekly_summary DO reuse existing categories (milestone_
// celebrations and weekly_summaries respectively) — both existed in
// 039_notification_preferences.sql with real, persisted toggles but no
// send path anywhere in the codebase until now (see that migration's own
// honesty note). This is the first code that actually gates on them.

export async function sendFriendRequest(
  userId: string,
  requesterDisplayName: string
): Promise<{ sent: number; errors: number }> {
  if (!(await notificationsGloballyEnabled(userId))) return { sent: 0, errors: 0 };

  return sendToUser(
    userId,
    "friend_request",
    `👋 ${requesterDisplayName} sent you a friend request`,
    "Tap to accept or decline.",
    "/friends"
  );
}

export async function sendFriendAccepted(
  userId: string,
  accepterDisplayName: string
): Promise<{ sent: number; errors: number }> {
  if (!(await notificationsGloballyEnabled(userId))) return { sent: 0, errors: 0 };

  return sendToUser(
    userId,
    "friend_accepted",
    `🎉 ${accepterDisplayName} accepted your friend request`,
    "You're now friends. See their progress on your friends list.",
    "/friends"
  );
}

export async function sendGroupInvite(
  userId: string,
  inviterDisplayName: string,
  groupName: string
): Promise<{ sent: number; errors: number }> {
  if (!(await notificationsGloballyEnabled(userId))) return { sent: 0, errors: 0 };

  return sendToUser(
    userId,
    "group_invite",
    `👥 ${inviterDisplayName} invited you to join ${groupName}`,
    "Tap to view the invite.",
    "/groups"
  );
}

export async function sendGoalInvitation(
  userId: string,
  inviterDisplayName: string,
  goalTitle: string
): Promise<{ sent: number; errors: number }> {
  if (!(await notificationsGloballyEnabled(userId))) return { sent: 0, errors: 0 };

  return sendToUser(
    userId,
    "goal_invitation",
    `🎯 ${inviterDisplayName} invited you to help with "${goalTitle}"`,
    "Tap to view and join in.",
    "/shared-goals"
  );
}

/** Fires for every currently-active member when a group quest completes
 *  (app/api/group-quests/check-completion/route.ts, after a successful
 *  public.service_complete_group_quest() call, 050) — reuses the
 *  milestone_celebrations preference, same framing as an individual goal
 *  completion celebration. */
export async function sendGroupQuestCompleted(
  userId: string,
  groupName: string,
  questTitle: string
): Promise<{ sent: number; errors: number }> {
  const allowed = await canSendNotificationToUser(userId, "milestone_celebrations");
  if (!allowed) return { sent: 0, errors: 0 };

  return sendToUser(
    userId,
    "group_quest_completed",
    `🏆 ${groupName} completed "${questTitle}"!`,
    "Great teamwork — check out the group's progress.",
    "/groups"
  );
}

async function sendPartnerReminder(userId: string): Promise<{ sent: number; errors: number }> {
  if (!(await notificationsGloballyEnabled(userId))) return { sent: 0, errors: 0 };

  return sendToUser(
    userId,
    "partner_reminder",
    "🤝 Check in with your accountability partner",
    "A quick nudge or encouragement can go a long way — see how they're doing.",
    "/partner"
  );
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
  const allUserIds = Array.from(new Set((partnerships as any[]).flatMap((p) => [p.requester_id, p.partner_id])));

  const { data: recentNudgeLogs } = await supabase
    .from("notification_logs")
    .select("user_id")
    .eq("notification_type", "partner_nudge")
    .in("user_id", allUserIds)
    .gte("created_at", fiveDaysAgo);
  const recentlyNudgedUserIds = new Set((recentNudgeLogs ?? []).map((r: any) => r.user_id));

  const { data: recentReminderLogs } = await supabase
    .from("notification_logs")
    .select("user_id")
    .eq("notification_type", "partner_reminder")
    .in("user_id", allUserIds)
    .gte("created_at", sevenDaysAgo);
  const recentlyRemindedUserIds = new Set((recentReminderLogs ?? []).map((r: any) => r.user_id));

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
  groupName: string,
  xpEarned: number,
  questsCompleted: number,
  activeMembers: number
): Promise<{ sent: number; errors: number }> {
  const allowed = await canSendNotificationToUser(userId, "weekly_summaries");
  if (!allowed) return { sent: 0, errors: 0 };

  return sendToUser(
    userId,
    "group_weekly_summary",
    `📊 ${groupName}'s week: ${xpEarned} XP earned`,
    `${activeMembers} active saver${activeMembers === 1 ? "" : "s"}${questsCompleted > 0 ? `, ${questsCompleted} quest${questsCompleted === 1 ? "" : "s"} completed` : ""} this week.`,
    "/groups"
  );
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
      try {
        const r = await sendGroupWeeklySummary(userId, group.name, xpEarned, questsCompleted, memberIds.length);
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