# ACCESSIBILITY_AUDIT.md — Sprint 27 (Notification & Communication System)

Final-phase audit. Method matches Sprint 22's: manual code reading for
most findings, plus a real automated pass using `eslint-plugin-jsx-a11y`
(present as a transitive dependency of `eslint-config-next`, same as
Sprint 22 found) run in `strict` mode against every notification UI
file, via a temporary config that was never committed. Every finding
below is either something the tooling actually flagged, or something
verified by reading the specific line of code and, where a numeric claim
is made, computing it.

## Method

```bash
# Temporary config, /tmp only, restored to the original
# {"extends": "next/core-web-vitals"} immediately after — never committed.
{
  "extends": ["next/core-web-vitals", "plugin:jsx-a11y/strict"],
  "plugins": ["jsx-a11y"]
}

npx eslint components/notifications/ \
  "app/(app)/settings/notifications/" \
  "app/(app)/digest/" \
  "app/(app)/achievements/" \
  --ext .ts,.tsx
```

Run twice: once before this phase's fix, once after, to confirm the fix
actually resolved what the tool flagged rather than trusting the diff
alone.

## Findings

### 1. FIXED (this phase) — NotificationCenter's backdrop failed two jsx-a11y/strict rules

**Tool output** (before fix):
```
components/notifications/NotificationCenter.tsx
  353:5  error  Visible, non-interactive elements with click handlers
                must have at least one keyboard listener
                jsx-a11y/click-events-have-key-events
  353:5  error  Avoid non-native interactive elements. If using native
                HTML is not possible, add an appropriate role and
                support for tabbing, mouse, keyboard, and touch inputs
                jsx-a11y/no-static-element-interactions
```

The panel's outer wrapper was a single `<div>` carrying both the
full-screen backdrop styling *and* an `onClick={onClose}` handler
("click outside to close") — a plain, non-interactive element with a
click handler and no keyboard equivalent. Keyboard users already had
Escape (verified working, unaffected), but switch-access/voice-control
users navigating by "click X" commands had no equivalent path to this
specific interaction.

**Fix**: restructured to match the pattern `components/ui/Modal.tsx`
(Sprint 22) already established and which this same tool confirms is
clean — a **separate** `aria-hidden="true"` backdrop `<div>` carrying
the click handler, sibling to (not wrapping) the dialog panel. Marking
it `aria-hidden` removes it from the interaction model assistive
technology navigates through entirely; mouse/touch users can still tap
it, keyboard users still have Escape, and the backdrop no longer needs
to be a focusable, labeled interactive element to satisfy either. The
inner panel's now-unnecessary `onClick={(e) => e.stopPropagation()}`
was removed too — with the backdrop as a sibling rather than a parent,
clicks inside the panel no longer bubble to it at all.

**Verified fixed**: re-ran the identical tool command after the change.
Zero errors, on this file and every other file in scope.

### 2. FIXED (Phase 12, reconfirmed this phase) — color contrast, computed not estimated

Sprint 27 Phase 12 computed actual WCAG contrast ratios (sRGB → linear
→ relative luminance → contrast ratio) for this app's low-opacity text
utilities against `surface-elevated` (`#1e1e28`):

| Opacity | Contrast | WCAG AA text (4.5:1) | WCAG AA non-text/icons (3:1) |
|---|---|---|---|
| `white/25` | 2.28:1 | Fail | Fail |
| `white/30` | 2.73:1 | Fail | Fail |
| `white/40` | 3.76:1 | Fail | Pass |
| `white/50` | 5.10:1 | Pass | Pass |

Every text usage at the failing levels across `NotificationCenter.tsx`,
`NotificationSettings.tsx`, `NotificationPreferencesClient.tsx`,
`DigestClient.tsx`, and `AchievementsClient.tsx` was bumped to
`white/50`; icon-only elements were held to the 3:1 bar, not the
stricter 4.5:1 one. `eslint-plugin-jsx-a11y` doesn't check color
contrast (no static analysis tool reliably can, since it requires
computing rendered colors) — this remains a manually-computed finding,
re-confirmed accurate this phase by re-reading the same file diffs.

### 3. FIXED (Phase 12) — toggle switch semantics

`NotificationSettings.tsx`'s push toggle was a hand-rolled `<button>`
with an `aria-label` but no `role="switch"`/`aria-checked` — a screen
reader announced it as a plain button, not a switch with an on/off
state. Migrated onto the shared `components/ui/Toggle.tsx` (which
already has this right, and already has dedicated test coverage —
`tests/component/Toggle.test.tsx`, 6 tests, now covering this instance
too for free).

### 4. FIXED (Phase 12) — zero screen-reader content in the digest bar charts

`DigestClient.tsx`'s `BarSeries` (savings/XP graphs) previously offered
only a `title` attribute per bar — mouse-hover-only, unreachable by
screen reader or keyboard. Fixed with `role="img"` + a descriptive
`aria-label` (total, day count, peak day/value) plus a visually-hidden
`<table>` with every data point. Covered by 3 component tests
(`tests/component/BarSeries.test.tsx`).

### 5. FIXED (Phase 12) — achievement deep-link highlight was sighted-users-only

`AchievementsClient.tsx`'s `?highlight=<id>` (Phase 6) called
`scrollIntoView()` only — moves the viewport, does nothing for a screen
reader user's position or keyboard focus. Fixed: the highlighted card
is now `tabIndex={-1}` and receives real `.focus()`, with an
`aria-label` announcing "\<title\> — just earned."

### 6. FIXED (Phase 12) — two missing label associations

`NotificationSettings.tsx`'s hour picker and
`NotificationPreferencesClient.tsx`'s vacation-end-date input both had
a `<label>` positioned visually above the control with no
`htmlFor`/`id` pairing — proximity only, not a programmatic
association. Fixed with matching `htmlFor`/`id` pairs on both.

### 7. FIXED (Phase 12) — the one real announcement-timing gap

`NotificationCenter`'s mark-read/archive/delete actions were checked
first and found **already correct** — all three route through the
shared `UndoSnackbar`, which has `role="status"` (implicit
`aria-live="polite"`). The one real gap: the panel's *initial load*
transition (spinner → loaded/error) had no announcement at all. Fixed
with a dedicated `loadStatus` state driving a small `aria-live` region,
firing once per fetch, not on every later list mutation (those are
already covered by the snackbar).

## Verified correct, not just assumed

- **Keyboard navigation / focus trap**: `NotificationCenter`'s
  `role="dialog"`, `aria-modal`, full focus trap, Escape-to-close, and
  focus restoration to the triggering element were already correct
  (built in an earlier sprint) — confirmed by reading the actual
  keydown handler and focus-restoration logic, not assumed from the
  presence of `role="dialog"` alone.
- **Reduced motion**: a global `@media (prefers-reduced-motion: reduce)`
  rule (Sprint 14, `app/globals.css`) already covers every
  animation/transition class used across the notification components.
  One honest caveat, not smoothed over: `AchievementsClient`'s
  `scrollIntoView({behavior:"smooth"})` is JS-driven, not CSS — the
  CSSOM View spec says browsers *should* respect the forced
  `scroll-behavior: auto` even for JS-triggered smooth scrolls, but
  this isn't universally guaranteed across every browser
  implementation the way the CSS-only cases are.
- **Template injection / XSS via notification content**: confirmed
  `renderTemplate()` (Phase 7) does a single-pass, non-recursive
  substitution — a malicious `display_name` containing literal
  `{{xp}}` text is inserted as-is, never re-scanned. Confirmed zero
  `dangerouslySetInnerHTML` usage anywhere in the notification UI —
  all content renders as plain, auto-escaped React text nodes.

## Recommended (not yet built)

- Bumping `NotificationCenter`'s Archive/Delete touch targets (~26×26px,
  above WCAG 2.2 AA's 24×24 minimum but below the common 44×44 mobile
  guideline) — needs row-layout re-spacing safer to verify visually
  than blind in this sandbox.
- A touch-specific always-visible (lower-opacity) state for the
  Archive/Delete actions, as a middle ground between the current
  hover/focus-only reveal (already self-documented in the code as a
  deliberate "quick-glance surface" tradeoff, confirmed keyboard users
  are unaffected via `group-focus-within`) and always-visible.

## Future work (out of scope)

- A broader contrast sweep of the app beyond notification-related
  components — the failing opacity levels are a pre-existing pattern
  used well beyond what this sprint touched.
- Automated contrast-ratio regression testing (a lint rule or CI check
  flagging low-opacity text on dark surfaces) to prevent this exact
  class of issue from being reintroduced silently.

## Known limitations

- `AchievementsClient`'s reduced-motion coverage for its JS-driven
  scroll is likely-but-not-guaranteed cross-browser (see above).
- Archive/Delete touch targets remain below the 44×44 mobile guideline
  (deliberate deferral, not an oversight — see Recommended).
