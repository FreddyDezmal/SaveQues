/**
 * lib/notificationGrouping.ts
 *
 * Pure function, no DB access — same convention as shouldNotifyUserNow() in
 * lib/notifications.ts, so it can be unit tested directly and reused
 * anywhere a notification list needs grouping (currently just
 * NotificationCenter, but this doesn't assume that).
 *
 * Generic over notification_type by design: it groups any run of 2+
 * same-type notifications, regardless of what the type string is. This
 * means achievement/XP-gain notifications (which don't exist in
 * notification_logs today — see the Sprint 16 migration's honesty note)
 * will group correctly the moment those types start appearing, with no
 * changes needed here. Only the friendly label needs a manual entry per
 * type; everything else in the grouping algorithm is type-agnostic.
 */

export interface GroupableNotification {
  id: string;
  notification_type: string;
  title: string;
  body: string;
  sent_at: string;
  read_at: string | null;
}

export type NotificationGroup =
  | { kind: "single"; notification: GroupableNotification }
  | { kind: "group"; notification_type: string; label: string; notifications: GroupableNotification[] };

// Friendly plural labels for known types. Deliberately NOT exhaustive over
// every possible future type — see FALLBACK_LABEL below for what happens
// when a type isn't listed here, which is the actual mechanism that makes
// this "easy to maintain": a brand new notification_type works correctly
// on day one without anyone remembering to update this file, and someone
// can add a nicer label here later purely as a copy improvement.
const TYPE_LABELS: Record<string, string> = {
  streak_at_risk:   "streak alerts",
  daily_quest:      "quest reminders",
  weekly_expiry:    "quest deadline alerts",
  seasonal_expiry:  "challenge alerts",
  inactive:         "check-in reminders",
};

function labelFor(type: string): string {
  return TYPE_LABELS[type] ?? type.replace(/_/g, " ");
}

/**
 * Groups consecutive notifications of the same type (as ordered by the
 * caller — NotificationCenter passes them sorted by sent_at desc, so
 * "consecutive" here effectively means "the same type showed up back to
 * back in recent history," not "ever, anywhere in all history"). A type
 * appearing twice with a different type in between produces two separate
 * entries rather than one merged one — that's intentional: if a user got a
 * quest reminder, then a streak alert, then another quest reminder, those
 * two quest reminders aren't really "one event," and merging them across
 * the gap would misrepresent the timeline.
 *
 * Threshold of 2: a single notification of a type is shown as itself, not
 * as a "group of 1" — grouping only kicks in where it actually saves the
 * user screen space and cognitive load.
 */
export function groupNotifications(notifications: GroupableNotification[]): NotificationGroup[] {
  const groups: NotificationGroup[] = [];
  let i = 0;

  while (i < notifications.length) {
    const current = notifications[i];
    let j = i + 1;
    while (j < notifications.length && notifications[j].notification_type === current.notification_type) {
      j++;
    }

    const run = notifications.slice(i, j);
    if (run.length >= 2) {
      groups.push({
        kind: "group",
        notification_type: current.notification_type,
        label: `${run.length} new ${labelFor(current.notification_type)}`,
        notifications: run,
      });
    } else {
      groups.push({ kind: "single", notification: current });
    }
    i = j;
  }

  return groups;
}
