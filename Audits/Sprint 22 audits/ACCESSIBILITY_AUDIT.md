# Sprint 22, Phase 15 — Accessibility Audit (real pass, now that UI exists)

`ACCESSIBILITY_GUIDANCE.md` (delivered earlier) was written honestly as
*guidance*, before any social UI existed to audit. That UI now exists —
this document is the actual audit, with real findings from real tooling
run against real code, not advice for a hypothetical future.

## Method

1. `eslint-plugin-jsx-a11y` was already present in `node_modules` as a
   transitive dependency of `eslint-config-next`, just not enabled in
   this project's own `.eslintrc.json`. Rather than guess whether the
   components were correct, I ran a temporary strict config
   (`plugin:jsx-a11y/strict`) against every new file, deleted it
   afterward — it was never added to the actual project config.
2. Manually checked touch-target sizes against the literal 44×44px
   requirement by reading the actual Tailwind padding values against
   actual icon sizes, not assuming the existing `.card`/button
   conventions already satisfied it.
3. Re-ran `tsc --noEmit`, `eslint` (real project config), and a full
   `next build` after every fix to confirm nothing broke.

## Findings — 3 real jsx-a11y violations

**1. `ContributeModal.tsx` — `autoFocus` on the amount input.**
`jsx-a11y/no-autofocus`. This wasn't just a lint nitpick: the `Modal`
component already moves focus to the dialog panel itself on open (via
`useFocusTrap`), specifically so a screen reader announces the dialog's
title/description first. Adding `autoFocus` to a field inside it fights
that — the field would grab focus a second time, skipping past the
context the dialog is supposed to give first. Fixed by removing it; the
existing focus-trap behavior is sufficient and correct on its own.

**2. `FriendCard.tsx` — a half-implemented ARIA menu.** The "more
actions" popover used `role="menu"`/`role="menuitem"`, which
`jsx-a11y/interactive-supports-focus` correctly flagged. Using that role
is a promise: the full ARIA Authoring Practices menu pattern (arrow-key
navigation between items, Home/End, typeahead, roving tabindex) — none
of which existed. On top of that, the close behavior was `onMouseLeave`
only, which **does not fire for keyboard users at all** — a keyboard
user who opened the menu had no way to close it except tabbing
elsewhere. This was a genuinely broken interactive pattern, not a
labeling nitpick. Rewritten as the simpler, fully-correct WAI-ARIA
**disclosure** pattern instead: a plain toggleable panel of ordinary
buttons (no special role needed — a `<button>` doesn't need a role to
be a button), with real `Escape`-to-close and click-outside-to-close
added via a proper event listener, and a `useRef` to check clicks
against.

**3. `UserSearchPicker.tsx` — redundant `role="list"` on a `<ul>`.**
`jsx-a11y/no-redundant-roles`. Trivial — a `<ul>` already has an
implicit `list` role; the explicit one added nothing and is exactly the
kind of small verbosity `no-redundant-roles` exists to catch. Removed.

## Findings — touch targets, checked by hand against the 44×44px number

`eslint-plugin-jsx-a11y` doesn't check pixel sizes — it can't know your
design tokens. Grepped for every icon-only button across the new UI and
did the arithmetic: Tailwind's `p-2` is 8px padding per side; an 18px
icon inside that is roughly 34px total, well under 44px. **Sixteen
icon-only buttons across 9 files** had this problem — Modal's close
button, both accept/decline icon pairs on friend requests, group
invites, and shared-goal invites, the group member management icons,
the group settings gear, and the shared-goal remove-contributor button.

Fixed all sixteen with `min-w-[44px] min-h-[44px]` plus `flex
items-center justify-center`, using negative margins (`-m-2.5` etc.)
where needed to keep the *visual* icon size unchanged while extending
the invisible tap target outward — rather than literally growing the
icon or its visible padding, which would have changed the design.

Checked the rest of the codebase for the same pattern while I was at
it — three more instances exist, but all in pre-existing files I never
touched (`UserActivityDrawer.tsx`, `BadgeDetailPanel.tsx`,
`GoalDetailClient.tsx`, `PortfolioClient.tsx`). Left alone, consistent
with not making unreviewed edits to code outside this sprint's scope —
noted here so it's not lost, worth a future pass.

## What was already correct (verified, not assumed)

- Every status badge already had text + icon, not color alone.
- Every destructive action was already behind `ConfirmationModal` with
  real focus trap / Escape / return-focus (via `useFocusTrap`).
- Accept/Decline buttons already carried the person's name in
  `aria-label`, not generic labels.
- Privacy selectors were already native `<select>` elements.
- The activity feed's pagination already used an `aria-live` region for
  "Loaded N more posts."

## What this audit still can't do

Same honest limits as before: no screen reader (VoiceOver/NVDA) session
against the running app — this sandbox has no live Supabase connection
to actually render authenticated pages with real data, only compile/
build them. `eslint-plugin-jsx-a11y` catches syntactic ARIA misuse and a
meaningful class of real bugs (as findings #1 and #2 above show — #2 in
particular was a genuinely broken keyboard interaction, not a cosmetic
issue), but it cannot verify color contrast against rendered pixels,
confirm focus order *feels* right when tabbing through a real page, or
catch anything that only shows up in actual assistive-tech behavior.
That real-device pass is still the right next step before calling this
fully verified.
