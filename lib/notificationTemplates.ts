/**
 * lib/notificationTemplates.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 27, Phase 7 — Notification Templates.
 *
 * Every notification's title/body text used to live as a template
 * literal inline at its send call site, scattered across
 * lib/notifications.ts, lib/reminderEngine.ts, and lib/digest.ts. This
 * file centralizes all of it into one registry, rendered through a
 * single `{{variable}}` substitution function — the brief's own example
 * syntax (`{{display_name}}`, `{{goal_name}}`, `{{amount}}`, `{{xp}}`,
 * `{{level}}`, `{{days}}`).
 *
 * DESIGN DECISION — pluralization/branching becomes template SELECTION,
 * not sentence-shape LOGIC, whenever the branches are actually different
 * sentences. A naive approach might embed a ternary inside a template
 * string or compute a pre-formatted phrase ("in 3 days") in code and
 * inject it as one variable — both leave English sentence-structure
 * living in code, which is exactly what "no hardcoded strings" rules
 * out. Instead, each place that previously branched on "today" vs "1
 * day" vs "N days" (a genuinely different sentence shape, not just a
 * plural) gets three separate, complete template keys (`_today` /
 * `_one_day` / `_many_days`), and the CALLER — still in code, where
 * decision logic belongs — picks which key to render. Same treatment
 * for group_weekly_summary's optional quest-count clause: it's either
 * present or entirely absent, a structural difference, so it's two full
 * template keys (`_with_quests` / `_no_quests`), not one template with a
 * conditionally-empty variable.
 *
 * The one exception: PURE single-word pluralization within an otherwise
 * identical sentence (quest/quests, saver/savers) is passed as one
 * variable (e.g. `{{quest_word}}`) rather than forking the whole
 * template. This mirrors how real i18n systems handle plural forms
 * (ICU MessageFormat, gettext) — a plural-rule choosing which WORD FORM
 * to use is not the same thing as composing sentence structure in code.
 * Every word a user actually reads still lives only in this file.
 *
 * LOCALIZATION-READY, NOT LOCALIZED — an honest distinction, not a
 * technicality. No translation exists anywhere in this codebase (no
 * i18n library, no locale-keyed string files — confirmed by a full
 * repo audit for this phase) even though `profiles.locale` has existed
 * since early on and is already used for number/date formatting
 * (lib/currency.ts's `formatAmount`). `renderNotificationTemplate()`
 * accepts a `locale` parameter and the registry is structured as
 * `Record<locale, Record<templateKey, Template>>` specifically so a
 * real translation could be added later as pure data — a new top-level
 * key in TEMPLATES_BY_LOCALE — without touching any call site or the
 * rendering logic. Today only `"en"` has content; any other locale
 * silently falls back to it rather than throwing, so this is additive
 * infrastructure, not a promise of translated copy that doesn't exist.
 */

export type TemplateVars = Record<string, string | number>;

export interface RenderedNotification {
  title: string;
  body: string;
}

interface Template {
  title: string;
  body: string;
}

const DEFAULT_LOCALE = "en";

// prettier-ignore
const TEMPLATES_BY_LOCALE: Record<string, Record<string, Template>> = {
  en: {
    // ── Streak & daily quest (lib/reminderEngine.ts) ──────────────────
    streak_at_risk: {
      title: "🔥 Your {{days}}-day streak is at risk!",
      body: "One deposit today keeps your {{days}}-day streak alive.",
    },
    daily_quest_goal: {
      title: "{{goal_emoji}} So close to your goal!",
      body: "You're only {{amount}} away from reaching \"{{goal_name}}\".",
    },
    daily_quest_xp: {
      title: "⭐ Almost there!",
      body: "You're only {{xp}} XP away from Level {{level}}.",
    },
    daily_quest_generic: {
      title: "📋 Daily quest waiting for you!",
      body: "You haven't completed today's quest yet. Finish it to earn XP.",
    },

    // ── Smart reminders (lib/reminderEngine.ts, Phase 3) ──────────────
    goal_almost_complete: {
      title: "{{goal_emoji}} {{percent}}% of the way there!",
      body: "Just {{amount}} left to finish \"{{goal_name}}\". You've got this.",
    },
    goal_deadline_today: {
      title: "⏰ \"{{goal_name}}\" is due today",
      body: "You still need {{amount}} to hit this goal. A deposit now keeps it on track.",
    },
    goal_deadline_one_day: {
      title: "⏰ \"{{goal_name}}\" is due in 1 day",
      body: "You still need {{amount}} to hit this goal. A deposit now keeps it on track.",
    },
    goal_deadline_many_days: {
      title: "⏰ \"{{goal_name}}\" is due in {{days}} days",
      body: "You still need {{amount}} to hit this goal. A deposit now keeps it on track.",
    },
    missed_weekly_deposit_with_goal: {
      title: "📅 No deposits yet this week",
      body: "\"{{goal_name}}\" needs {{amount}} more — a quick deposit before the week ends keeps your progress moving.",
    },
    missed_weekly_deposit_generic: {
      title: "📅 No deposits yet this week",
      body: "The week's almost over and no deposits are logged yet. Even a small one keeps your momentum going.",
    },
    group_quest_ending_today: {
      title: "⌛ \"{{quest_title}}\" ends today",
      body: "{{group_name}}'s group quest wraps up soon — jump in before it closes.",
    },
    group_quest_ending_one_day: {
      title: "⌛ \"{{quest_title}}\" ends in 1 day",
      body: "{{group_name}}'s group quest wraps up soon — jump in before it closes.",
    },
    group_quest_ending_many_days: {
      title: "⌛ \"{{quest_title}}\" ends in {{days}} days",
      body: "{{group_name}}'s group quest wraps up soon — jump in before it closes.",
    },

    // ── Quest/challenge expiry & inactivity (lib/notifications.ts) ────
    weekly_expiry_one_day: {
      title: "⏰ Weekly quest expires in 1 day",
      body: "Don't let your weekly quest expire — complete it before Sunday!",
    },
    weekly_expiry_many_days: {
      title: "⏰ Weekly quest expires in {{days}} days",
      body: "Don't let your weekly quest expire — complete it before Sunday!",
    },
    seasonal_expiry_one_day: {
      title: "⚡ \"{{quest_title}}\" ends in 1 day",
      body: "Complete this seasonal challenge before it expires to earn bonus XP.",
    },
    seasonal_expiry_many_days: {
      title: "⚡ \"{{quest_title}}\" ends in {{days}} days",
      body: "Complete this seasonal challenge before it expires to earn bonus XP.",
    },
    inactive: {
      title: "👋 We miss you at SaveQuest!",
      body: "It's been {{days}} days since your last saving. Your goals are waiting.",
    },

    // ── Achievements & milestones ──────────────────────────────────────
    achievement_unlocked: {
      title: "{{achievement_icon}} Achievement unlocked: {{achievement_title}}",
      body: "Tap to see your badge collection.",
    },
    milestone_celebration: {
      title: "🎉 Goal complete: {{goal_name}}!",
      body: "You did it — check out your progress and start your next goal.",
    },

    // ── Digests (lib/digest.ts, Phase 5) ───────────────────────────────
    weekly_summary: {
      title: "📊 Your week in review",
      body: "You saved {{amount}}, completed {{quests}} {{quest_word}}, and earned {{xp}} XP. Tap for your full recap.",
    },
    monthly_summary: {
      title: "🗓️ Your month in review",
      body: "You saved {{amount}} this month and your momentum is \"{{momentum_label}}\". Tap for the full breakdown.",
    },

    // ── Partners (Sprint 22) ────────────────────────────────────────────
    partner_request: {
      title: "🤝 {{display_name}} wants to be your accountability partner",
      body: "Tap to accept or decline.",
    },
    partner_accepted: {
      title: "🎉 {{display_name}} accepted your partner request",
      body: "You're now accountability partners. Tap to see their progress.",
    },
    partner_nudge: {
      title: "👋 {{display_name}} sent you a nudge",
      // Body is a caller-supplied fallback ONLY — sendPartnerNudge() uses
      // the partner's own free-text message when one was provided, which
      // is user-generated content, not a template (see that function).
      body: "Keep going — your partner is cheering you on!",
    },
    partner_reminder: {
      title: "🤝 Check in with your accountability partner",
      body: "A quick nudge or encouragement can go a long way — see how they're doing.",
    },

    // ── Friends & groups ─────────────────────────────────────────────────
    friend_request: {
      title: "👋 {{display_name}} sent you a friend request",
      body: "Tap to accept or decline.",
    },
    friend_accepted: {
      title: "🎉 {{display_name}} accepted your friend request",
      body: "You're now friends. See their progress on your friends list.",
    },
    group_invite: {
      title: "👥 {{display_name}} invited you to join {{group_name}}",
      body: "Tap to view the invite.",
    },
    goal_invitation: {
      title: "🎯 {{display_name}} invited you to help with \"{{goal_name}}\"",
      body: "Tap to view and join in.",
    },
    group_quest_completed: {
      title: "🏆 {{group_name}} completed \"{{quest_title}}\"!",
      body: "Great teamwork — check out the group's progress.",
    },
    group_weekly_summary_no_quests: {
      title: "📊 {{group_name}}'s week: {{xp}} XP earned",
      body: "{{active_members}} active {{member_word}} this week.",
    },
    group_weekly_summary_with_quests: {
      title: "📊 {{group_name}}'s week: {{xp}} XP earned",
      body: "{{active_members}} active {{member_word}}, {{quests}} {{quest_word}} completed this week.",
    },
  },
};

// ── Rendering ────────────────────────────────────────────────────

/**
 * Replaces every `{{key}}` in `template` with `vars[key]`. A variable
 * referenced in the template but missing from `vars` is left as the
 * literal `{{key}}` marker (not silently blanked, not thrown) — a
 * notification send must never fail because of a template/vars drift,
 * but a visibly wrong push in QA is far easier to catch than a
 * silently-blank one in production.
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (!(key in vars)) {
      console.warn(`[notificationTemplates] Missing variable "${key}" in template: ${template}`);
      return match;
    }
    return String(vars[key]);
  });
}

/**
 * Renders a named template with the given variables. Throws on an
 * unknown key — unlike a missing variable (a data problem, tolerated so
 * a send still goes out), an unknown template key is a code bug (a
 * typo'd key, or a template renamed without updating its caller) that
 * should fail loudly in development rather than silently send garbage.
 */
export function renderNotificationTemplate(
  key: string,
  vars: TemplateVars,
  locale: string = DEFAULT_LOCALE
): RenderedNotification {
  const templates = TEMPLATES_BY_LOCALE[locale] ?? TEMPLATES_BY_LOCALE[DEFAULT_LOCALE];
  const template = templates[key] ?? TEMPLATES_BY_LOCALE[DEFAULT_LOCALE][key];
  if (!template) {
    throw new Error(`[notificationTemplates] Unknown template key: "${key}"`);
  }
  return {
    title: renderTemplate(template.title, vars),
    body: renderTemplate(template.body, vars),
  };
}

/** For tooling/tests — every registered template key for a locale (defaults to "en"). */
export function listTemplateKeys(locale: string = DEFAULT_LOCALE): string[] {
  return Object.keys(TEMPLATES_BY_LOCALE[locale] ?? TEMPLATES_BY_LOCALE[DEFAULT_LOCALE]);
}
