/**
 * lib/notifications.ts
 * Core notification dispatch logic — used by cron job and manual triggers.
 */

import { createServiceClient } from "./supabase/server";
import { sendWebPush, type SendResult } from "./webpush";
import type { NotificationType, PushPayload, PushSubscriptionRow } from "./types.notifications";
import { getDaysRemainingInWeek } from "./weeklyQuests";

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayInTZ(tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function currentHourInTZ(tz: string): number {
  try {
    return parseInt(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(new Date()),
      10
    );
  } catch {
    return new Date().getUTCHours();
  }
}

async function logNotification(
  userId: string,
  subscriptionId: string | null,
  type: NotificationType,
  title: string,
  body: string,
  result: SendResult
): Promise<string> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("notification_logs")
    .insert({
      user_id:           userId,
      subscription_id:   subscriptionId,
      notification_type: type,
      title,
      body,
      error: result.ok ? null : (result.error ?? `HTTP ${result.status}`),
    })
    .select("id")
    .single();

  return data?.id ?? "";
}

async function deactivateSubscription(endpoint: string) {
  const supabase = createServiceClient();
  await supabase
    .from("push_subscriptions")
    .update({ is_active: false })
    .eq("endpoint", endpoint);
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
    };

    const result = await sendWebPush(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload
    );

    await logNotification(userId, sub.id, type, title, body, result);

    if (result.ok) {
      sent++;
    } else {
      errors++;
      if (result.gone) {
        await deactivateSubscription(sub.endpoint);
      }
    }
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
        notifications_enabled
      )
    `)
    .eq("is_active", true)
    .eq("profiles.notifications_enabled", true);

  if (error || !subs) {
    console.error("[notifications] Failed to fetch subscriptions:", error);
    return { processed: 0, notifications_sent: 0, errors: 1 };
  }

  // Deduplicate by user_id (one user may have multiple subscriptions)
  const usersToProcess = new Map<string, {
    timezone: string;
    notificationHour: number;
    streakDays: number;
    lastActiveDate: string | null;
  }>();

  for (const sub of subs as any[]) {
    const p = sub.profiles;
    if (!p) continue;
    usersToProcess.set(p.id, {
      timezone:         sub.timezone ?? "UTC",
      notificationHour: p.last_notification_hour ?? 20, // default 8 PM
      streakDays:       p.streak_days ?? 0,
      lastActiveDate:   p.last_active_date,
    });
  }

  for (const [userId, userInfo] of usersToProcess) {
    const { timezone, notificationHour, streakDays, lastActiveDate } = userInfo;
    const localHour = currentHourInTZ(timezone);
    const today     = todayInTZ(timezone);

    // Only send during user's preferred notification hour (±0)
    if (localHour !== notificationHour) continue;

    processed++;

    const daysSinceActive = lastActiveDate
      ? Math.floor((new Date(today).getTime() - new Date(lastActiveDate).getTime()) / 86400000)
      : 999;

    // 1. Inactive 3+ days
    if (daysSinceActive >= 3) {
      const r = await sendInactiveReminder(userId, daysSinceActive);
      notifications_sent += r.sent; errors += r.errors;
      continue; // don't spam with other notifications
    }

    // 2. Streak at risk (active yesterday but not today)
    if (streakDays > 0 && daysSinceActive === 1) {
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

    if (!questLog) {
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

      if (weeklyQuest) {
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
        if (daysLeft >= 1 && daysLeft <= 3) {
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
