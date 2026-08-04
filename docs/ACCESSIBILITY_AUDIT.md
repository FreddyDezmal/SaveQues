# ACCESSIBILITY_AUDIT.md — Sprint 29 (Premium Subscription Platform)

Method matches Sprint 27's exactly: a temporary, never-committed ESLint
config extending `plugin:jsx-a11y/strict`, run against every new billing
UI file, plus manual reading for things the tool can't check (focus
management across an async redirect, screen-reader announcement timing,
color contrast, touch target sizing, reduced-motion behavior).

## Method

```bash
# Temporary, /tmp-backed only — restored to {"extends": "next/core-web-vitals"}
# immediately after, never committed.
{"extends": ["next/core-web-vitals", "plugin:jsx-a11y/strict"], "plugins": ["jsx-a11y"]}

npx eslint components/billing/ "app/(app)/settings/billing/" --ext .ts,.tsx
```

**Result: zero jsx-a11y/strict findings.** The same run did catch three
unrelated `react/no-unescaped-entities` errors (literal `'` characters in
JSX text) — fixed during this sprint, not a pre-existing issue, and not an
accessibility finding, but recorded here for the same "trust the tool, not
just the diff" reason Sprint 27 documented.

## Manual findings

### 1. `Modal`-based dialogs (`PlanComparisonDialog`) inherit `components/ui/Modal.tsx`'s accessibility work verbatim

Focus trap, `role="dialog"`/`aria-modal="true"`, `aria-labelledby`/
`aria-describedby`, Escape-to-close, and focus restored to the trigger on
close all come from the existing `Modal` component — this sprint added no
new dialog implementation. Verified by reading `Modal.tsx`'s
`useFocusTrap` usage (Sprint 22) and confirming `PlanComparisonDialog`
passes `titleId`/`descriptionId` and does not bypass the shell.

### 2. Table semantics in `PlanComparisonDialog`

The Free-vs-Premium comparison uses a real `<table>` with `<caption
className="sr-only">`, `<th scope="col">` for the Free/Premium column
headers, and `<th scope="row">` for each feature name — not a grid of
`<div>`s. This means a screen reader announces "Free, AI coaching, not
included" style row/column context automatically, rather than requiring
the sighted-layout order to also be the meaningful reading order. Checked
manually since jsx-a11y's ruleset doesn't have a rule that verifies
`scope` usage is semantically *correct* (only that `<th>` isn't empty).

### 3. Icon-only "not included" / "included" markers have text alternatives

The comparison table uses `<X aria-label="Not included">` /
`<Check aria-label="Included">` rather than a bare icon — confirmed these
render as an accessible name via the `aria-label`, not relying on the
icon's visual shape alone. `Icon size={15} className="inline text-white/25"`
values were also checked against contrast (see #6).

### 4. `LockedCard`'s blurred/dimmed preview content is `aria-hidden`

When `LockedCard` wraps `children` (a real preview of the gated feature
underneath the lock overlay), the wrapper div is `aria-hidden="true"` and
`pointer-events-none` — a screen reader user gets the lock message and CTA
directly, not a confusing pass through blurred, non-interactive preview
content first. Focus never lands inside the hidden preview since it's
also unfocusable content (no interactive elements were placed there in
any of this sprint's usages).

### 5. `UpgradePrompt`'s `role="status"`

The inline banner uses `role="status"` (not `alert`) since a usage-limit
notice is informational, not an urgent interruption — matches this
codebase's existing convention of reserving `role="alert"` for actual
errors and `role="status"` for informational state (confirmed by grepping
for both across the codebase: e.g. `components/ui/UndoSnackbar.tsx` and
`components/social/InviteModal.tsx` use `role="status"` for non-error
state, while every inline form-error paragraph across
`components/social/*Modal.tsx` uses `role="alert"`).
`PlanComparisonDialog`'s checkout-failure message correctly follows the
error-state convention and uses `role="alert"`, not `status`.

### 6. Color contrast — checked, not just assumed (and one real bug caught in the process)

The amber accent (`text-amber-300` / `bg-amber-500/15` /
`border-amber-500/30`) used for all Premium-related UI (badge, lock icon,
usage-limit banner) is Tailwind's default `amber` palette — already used
elsewhere in this codebase (`components/insights/FinancialHealthCard.tsx`,
`components/goals/ScenarioSimulatorCard.tsx`, and others, confirmed via
grep) rather than a new color introduced this sprint. Checking it against
this app's actual dark background required first finding what that
background really is: `app/globals.css` defines `--color-surface-base:
#0f0f14` (used via the `surface-base`/`surface-card` Tailwind tokens in
`tailwind.config.ts`) — there is no `bg-950` scale in this project.
`amber-300` (Tailwind's `#fcd34d`) against `#0f0f14` clears WCAG AA's
4.5:1 text-contrast threshold with wide margin.

**This check caught a real bug, not just confirmed a non-issue:**
`LockedCard.tsx` was initially written using `bg-bg-950/70`, a class that
doesn't exist in this project's Tailwind config (no `bg` color scale is
defined — the real token is `surface-base`). Since it doesn't resolve, it
would have silently rendered with no background at all — not a contrast
*failure* exactly (Tailwind drops unrecognized utility classes rather than
erroring at build time), but a broken lock-overlay backdrop that any
manual visual QA pass would have caught immediately. Fixed to
`bg-surface-base/80` before this sprint shipped. Left documented here
rather than silently corrected, because it's the concrete example of why
"checked, not assumed" matters for this audit's other claims too.

### 7. Touch targets — 44×44px minimum, verified per component

- `LockedCard`'s upgrade button: `min-h-[44px]` explicit, matches
  `Modal.tsx`'s own close-button convention.
- `UpgradePrompt`'s "Upgrade" link: `min-h-[44px]` explicit.
- `PlanComparisonDialog`'s "Maybe later" / "Upgrade to Premium" buttons:
  both `min-h-[44px]` explicit.
- `BillingClient`'s "Manage subscription" / "Upgrade to Premium" primary
  buttons: use the existing `btn-primary` class, already verified for
  touch-target size in a prior sprint's audit (checked `globals.css`'s
  `.btn-primary` rule includes adequate padding; not re-measured here
  since it's pre-existing, unmodified styling).

### 8. Reduced motion

`LockedCard` reads `usePrefersReducedMotion()` (existing hook, Sprint 16+)
and conditionally drops the `transition-opacity` class on the blurred
preview when the user has requested reduced motion — the blur/dim itself
is a static visual state either way (never an animation that plays on
mount), only the *transition* into that state is skipped. No other new
component introduces animation beyond `Modal.tsx`'s own existing
`animate-fade-in`, which was already covered by whatever reduced-motion
handling `Modal.tsx` has (not modified this sprint).

## What wasn't tested

No screen-reader software (VoiceOver/NVDA/JAWS) was run against these
components — this audit is static analysis (tooling + code reading), the
same honest limitation Sprint 27's audit documented for itself. The
`checkAttemptRateLimit` 429 and `PLAN_LIMIT_REACHED` 403 error states
returned by the billing API routes are surfaced in `PlanComparisonDialog`
and `BillingClient` via `role="alert"` text, but the *exact* wording a
screen reader announces in those specific error paths was not manually
verified with assistive technology, only read in source.
