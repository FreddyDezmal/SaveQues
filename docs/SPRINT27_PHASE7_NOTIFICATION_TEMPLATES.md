# Sprint 27 — Phase 7: Notification Templates

## 1. What this phase is

"Centralize templates. No hardcoded strings. Support variables
(`{{display_name}}`, `{{goal_name}}`, `{{amount}}`, `{{xp}}`, `{{level}}`,
`{{days}}`). Localization-ready."

## 2. Audit: what existed before

Every notification's title/body text lived as a template literal inline
at its send call site — 15 in `lib/notifications.ts` directly, plus 6
copy-building functions in `lib/reminderEngine.ts` (Phase 3) and 2 in
`lib/digest.ts` (Phase 5). No central registry, no `{{variable}}`
syntax, no locale awareness anywhere in the copy layer — despite
`profiles.locale` existing since early sprints and already being used
for number/date formatting (`lib/currency.ts`'s `formatAmount`).

## 3. What this phase built

### `lib/notificationTemplates.ts` (new, pure)

A single registry (`TEMPLATES_BY_LOCALE`) of every notification's title
and body, using exactly the brief's `{{variable}}` syntax, plus two
functions:
- `renderTemplate(template, vars)` — the substitution primitive.
- `renderNotificationTemplate(key, vars, locale?)` — looks up a named
  template and renders both fields at once.

**Every one of the ~23 previously-hardcoded notification texts now
lives here and nowhere else.** Confirmed by grep after migration: every
`sendToUser(...)` call site in `lib/notifications.ts` passes a `title`/
`body` variable pair, never a string literal.

### Design decision: template *selection*, not template *logic*

A naive implementation might embed a ternary inside a template string,
or compute a pre-formatted phrase ("in 3 days") in code and inject it as
one variable. Both still leave English sentence structure living in
code — exactly what "no hardcoded strings" rules out.

Instead: **structurally different sentences get separate, complete
template keys**, and the caller (still in code, where decision logic
belongs) picks which one to render:
- `goal_deadline_{today,one_day,many_days}` — "due today" and "due in N
  days" are different sentence shapes, not a plural of each other.
- `group_quest_ending_{today,one_day,many_days}` — same reasoning.
- `weekly_expiry_{one_day,many_days}`, `seasonal_expiry_{one_day,many_days}`
- `group_weekly_summary_{with_quests,no_quests}` — the quest-count
  clause is either present or entirely absent, a structural difference.

**Pure single-word pluralization** within an otherwise identical
sentence (quest/quests, saver/savers) is the one exception — passed as
one variable (`{{quest_word}}`) rather than forking the whole template,
mirroring how real i18n systems (ICU MessageFormat, gettext) handle
plural forms: a plural rule choosing a word form is not the same thing
as composing sentence structure in code.

### Migration verified byte-for-byte, not just "should still work"

Every existing test that exercises rendered copy —
`tests/unit/reminderEngine.test.ts` (40 tests) and
`tests/unit/digest.test.ts` (10 tests) — **passed unchanged** after the
migration, with zero test edits needed. Since those tests assert exact
strings (e.g. `"One deposit today keeps your 34-day streak alive."`),
this is a real regression check, not just "it compiles": the templated
output is character-for-character identical to the pre-migration inline
strings. One near-miss caught during migration: an early draft of
`group_weekly_summary`'s template had "N savers active" where the
original said "N active savers" — different word order, same words.
Fixed before it reached a passing test, by re-deriving the template from
the original string rather than from memory of what it "should" say.

### `lib/notificationTemplates.test.ts` (new, 11 tests)

Covers the substitution primitive (single/repeated/numeric variables,
missing-variable behavior), `renderNotificationTemplate`'s locale
fallback and unknown-key error, and spot-checks a few rendered templates
directly (streak, goal-deadline family, daily-quest variants).

## 4. "Localization-ready," honestly

**Not localized. Structurally ready for localization.** This is a
deliberate, stated distinction, not a technicality to gloss over:

- No translation exists anywhere in this codebase — confirmed by a full
  audit for this phase (no i18n library, no locale-keyed string files).
- `renderNotificationTemplate()` already accepts a `locale` parameter
  and `TEMPLATES_BY_LOCALE` is already shaped as
  `Record<locale, Record<templateKey, Template>>`.
- Adding real French copy, for example, would mean adding one new
  top-level `fr: { ... }` entry to that object — pure data — with **zero
  changes** to any call site, to the rendering logic, or to any of the
  ~23 places across `notifications.ts`/`reminderEngine.ts`/`digest.ts`
  that call `renderNotificationTemplate()`.
- Today, requesting any locale other than `"en"` silently falls back to
  `"en"` rather than throwing — this is additive infrastructure sitting
  ready, not a claim that translated copy exists.
- `profiles.locale` is not yet threaded into any notification send call
  (every call today either omits the `locale` param or would need it
  passed from the caller) — see §6.

## 5. Variable naming

Used the brief's own names wherever they map directly: `{{display_name}}`,
`{{goal_name}}`, `{{amount}}`, `{{xp}}`, `{{level}}`, `{{days}}`. The
brief's list was illustrative, not exhaustive — a real system spanning
23 notification types across quests, goals, groups, partners, and
digests needs more than six variables. Added as needed, each named for
what it holds rather than reused ambiguously: `{{goal_emoji}}`,
`{{percent}}`, `{{quest_title}}`, `{{group_name}}`,
`{{achievement_icon}}`/`{{achievement_title}}`, `{{momentum_label}}`,
`{{active_members}}`, `{{quests}}`, plus the word-form variables
(`{{quest_word}}`, `{{member_word}}`) discussed in §3.

## 6. Verified / recommended / future work / known limitations

**Verified** (actually run in this sandbox):
- `npx tsc --noEmit` — 0 new type errors; the same 2 pre-existing,
  unrelated errors remain.
- `npx vitest run` (full suite) — 428 passed, 0 failed (up from 416
  before this phase — the +11 are `notificationTemplates.test.ts`, +1 is
  a test added in Phase 6). Every pre-existing copy-asserting test
  (`reminderEngine.test.ts`, `digest.test.ts`, 50 tests combined) passed
  **without modification**, confirming the migration preserved exact
  user-facing copy.
- Manually grepped every `sendToUser(...)` call site after migration to
  confirm zero string literals remain in the title/body positions.

**Recommended, not yet built:**
- Thread `profiles.locale` through to `renderNotificationTemplate()`'s
  `locale` parameter at each call site (currently always defaults to
  `"en"`) — a small, mechanical follow-up once there's a second locale's
  content to actually select.

**Future work (explicitly out of scope for Phase 7):**
- Real translated content for any locale other than `"en"` — no
  translator, translation workflow, or second-locale content exists;
  building the seam (this phase) and filling it with translations
  (future work) are deliberately separate efforts.
- A build-time or CI check that every `NotificationType` has a
  corresponding template key (today this is implicit — an unknown key
  throws at render time, not at compile time or build time).

**Known limitations:**
- `partner_nudge`'s body is the one template that's genuinely optional
  at render time: `sendPartnerNudge()` prefers the partner's own
  free-text message (user-generated content — correctly never
  templated) and only falls back to the registry's generic body when no
  message was given. Documented in the template's own comment so it
  isn't mistaken for an unused template.
- No template exists for "Subscription renewal" or "Referral joined"
  from the original sprint doc's Phase 2 examples — consistent with
  Phase 3's and Phase 4's own honesty notes: neither feature exists in
  this codebase, so there is nothing to template.
