# Admin CRUD Audit — Quests, Chains, Badges, Events

Scope: does the admin CRUD for daily quests, weekly quests, seasonal challenges,
quest chains, badges, and events actually connect to real, server-verified
completion logic — or does the system trust the client's "I did it" click at
face value? This document answers that directly, with file/line evidence,
then lists every fix applied and everything deliberately left as a
documented follow-up.

**Read this first — severity ranking of what was found:**

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | `award_xp()` is directly callable by any authenticated user with no way to verify the XP amount corresponds to a real event | **Critical** | Partially mitigated (migration 040) — see caveat below |
| 2 | `user_weekly_quests` had an open RLS policy allowing direct client writes, bypassing all XP/requirement checks | **Critical** | Fixed (migration 041) |
| 3 | Seasonal challenge completion silently failed to persist `status='completed'` (RLS/code mismatch) | **High** (data-integrity bug, not exploitable for extra XP) | Fixed (migration 039) |
| 4 | No subsystem checked that a quest/chain-step's actual requirement was met before awarding XP | **High** | Fixed for quests + chain steps (migrations 038, code changes); events already had timing checks |
| 5 | Admin-created badges and quest chains have zero effect on real gameplay (disconnected catalogs) | **Medium** (product/architecture gap, not a security hole) | Documented + UI warnings added; not restructured |
| 6 | Daily quest completion didn't even check the quest id existed | **Medium** | Fixed |
| 7 | Two chain steps had a requirement type that didn't match their description | **Low** (content bug, surfaced by fix #4) | Fixed |

---

## Your questions, answered directly

### "Do they validate when a user actually completes the requirements, or can they just press complete and it believes them at face value?"

**Before this pass: face value, everywhere, with one exception (events).** Every completion endpoint computed XP correctly server-side (so the *amount* couldn't be tampered with) and was idempotent (so it couldn't be replayed for extra XP), but none of them checked that the underlying task was actually done:

- `app/api/quest/daily/complete/route.ts` accepted *any* `questId` string — it never even queried the `daily_quests` table to check the quest existed.
- `app/api/quest/weekly/complete/route.ts` checked the quest existed and pulled `xp_reward` from the DB (so at least a real, admin-defined quest was being completed), but there was no field anywhere in the schema to check *what* had to be true — `weekly_quests` had no requirement column at all.
- `app/api/quest/chain/step/route.ts` — this one is the most interesting: the DB schema (`quest_chain_steps.requires_type` / `requires_value` / `requires_quest_id`, migration 016) clearly anticipated real validation, and the route's own doc comment even implies guarantees it wasn't providing. But the completion RPC (`complete_chain_step`) only checked `current_step = p_step AND status = 'active'` — sequential ordering, nothing about the requirement. A user could click through an entire chain, including steps that claim to need a 30-day streak or R1,000 saved, instantly.
- `app/api/quest/challenge/complete/route.ts` — also no requirement check, plus a separate bug (see below).
- `app/api/events/complete/route.ts` — **this one was already doing it right.** See the events section below.

**Now:** daily quests, weekly quests, and chain steps all validate real data (streak days, amounts saved, prior completions) before awarding XP, using a new shared module (`lib/questRequirements.ts`). Full detail in "What was fixed" below.

### "Does it refute users from completing timed events before they're actually over? Example: 'Log in every day this week' — will it fact-check using their streak and current date, or can they press complete after accepting and be awarded XP?"

Two different systems answer this differently, and it's worth being precise about which one your example fits:

- **If "log in every day this week" is a `weekly_quests` entry** (which is what it sounds like): before this pass, no — nothing checked the streak or the date, a user could accept it and complete it five minutes later. **Now:** if an admin sets `requirement_type = 'streak'` and `requirement_value = 7` on that quest, `app/api/quest/weekly/complete/route.ts` checks `profile.streak_days >= 7` before awarding XP, and rejects with a 409 and a clear reason if it isn't true yet. If no requirement is set (the default), it's still self-reported — that's an explicit, backward-compatible choice, not an oversight (see migration 038's comments).
- **If it's an `events` entry** (the seasonal/time-boxed system): this one already fact-checks the *date* correctly. `app/api/events/complete/route.ts` calls `getEventWindow()` (`lib/events.ts`) and rejects completion with a 400 if the event's status is `"expired"` or if it isn't currently joinable. That logic is genuinely well-built — worth calling out as something that was already right, not just problems.

### "When an admin adds a badge, is there a way to specify the exact criteria (such as a specific day for the streak)?"

**No — and this was the most surprising finding.** The `badges` database table (what the admin CRUD manages) is **completely disconnected** from both what users see and what actually gets awarded:

- User-facing badge/achievement displays (`ProfileClient.tsx`, `DashboardClient.tsx`) read from a **hardcoded TypeScript array**, `ACHIEVEMENTS` in `lib/achievements.ts` — never from the `badges` table.
- The actual awarding logic (`checkAndAwardAchievements()` in `lib/awardXP.ts`) also runs entirely off that same hardcoded array and its `check()` function calls — never from the `badges` table.
- Nothing in the codebase reads `badges.unlock_criteria` for any purpose other than displaying it back in the admin UI. It's a free-text field with zero parsing or enforcement anywhere.

**So: creating a badge in the admin panel creates a badge nobody will ever see and nobody can ever earn**, until a developer separately hand-writes a matching entry + `check()` call in `lib/achievements.ts` and ships a code deploy. There is currently no way — none — for an admin to specify criteria like "streak reaches exactly day 7" through the admin UI and have it actually enforced. I did not attempt to unify these two systems in this pass (see "Deliberately not fixed" below) but I did add an explicit warning banner directly in the admin Badges tab so this isn't a silent trap anymore.

**The same disconnect exists for quest chains**, which I didn't expect going in: `app/api/admin/quest-chains` manages `quest_chains`/`quest_chain_steps` DB tables, but the live chain-progression route (`app/api/quest/chain/step/route.ts`) reads chain definitions from a separate hardcoded constant, `QUEST_CHAINS` in `lib/quests.ts`. Same fix applied: a warning banner in the admin Chains tab.

### "Will upcoming events actually show, or will it remain stale and surprise the user?"

**This one checks out — genuinely well-built, no fix needed.** `lib/questAvailability.ts` / `lib/events.ts::getEventWindow()` computes a real status (`active` / `upcoming` / `expired`) from `available_from`, `available_until`, and `preview_days`, and `app/(app)/events/page.tsx` filters to show only events that are currently active *or* upcoming-and-within-their-preview-window:

```ts
.filter((e: any) =>
  e.window.status === "active" ||
  (e.window.status === "upcoming" && (e.window.startsInDays ?? 999) <= e.preview_days)
)
```

An event that's 40 days away with a 7-day preview window correctly stays hidden until it's actually within 7 days out. No stale/surprise events, no early-showing events. This was the one subsystem in the whole audit that didn't need a fix.

---

## What was fixed

All fixes ship as new, additive migrations (038-041) with matching rollback files in `supabase/migrations/rollback/`, plus the corresponding application code changes in the same pass. Nothing existing was deleted or renamed; every schema change is backward-compatible (new nullable/defaulted columns, new RLS policies replacing overly-permissive ones, a new RPC).

1. **`lib/questRequirements.ts`** (new) — shared, pure, typed requirement-checking logic used by all three completion routes below. Two vocabularies: a small one for quests (`none`/`streak`/`save_amount`) and the pre-existing, richer one for chain steps (`open_app`/`streak`/`save_amount`/`complete_daily`/`complete_quest`).

2. **Migration 038** — adds `requirement_type`/`requirement_value` to `daily_quests` and `weekly_quests` (default `'none'`, fully backward-compatible — nothing that worked before becomes blocked by this migration alone). `app/api/admin/daily-quests/route.ts` and `app/api/admin/weekly-quests/route.ts` now validate and persist these fields, so admins can actually set real criteria going forward.

3. **`app/api/quest/daily/complete/route.ts`** — now checks the quest exists and is active (previously didn't check at all), and validates `requirement_type`/`requirement_value` against the user's real streak/today's deposits before awarding XP. Documented, not silently changed: this route's XP idempotency key is `(user_id, quest_date)`, not `quest_id` — meaning only the *first* quest claimed each day is ever paid, a pre-existing "one daily reward per day" design that this fix doesn't alter.

4. **`app/api/quest/weekly/complete/route.ts`** — same shape of fix, checking real streak days / this-week's deposits against the quest's requirement.

5. **`app/api/quest/chain/step/route.ts`** — now validates `step.requiresType`/`requiresValue`/`requiresQuestId` (from `lib/quests.ts`'s `QUEST_CHAINS`) against real data: streak days, lifetime saved, cumulative daily-quest completions, specific quest completion history (merged from `daily_quest_logs` and completed `user_weekly_quests`), and completed-goals count. While building this, found and fixed **two content bugs**: "Create a Goal" and "Create Emergency Goal" steps were typed `requiresType: "complete_daily"` (checking daily-quest completions — completely unrelated to creating a goal); changed to `"open_app"`, preserving the pre-existing effectively-unchecked behavior for exactly those two steps rather than enforcing an unrelated signal. Also found that `"complete_quest"` is used for two different meanings in the existing content (a specific quest id vs. a count of completed savings goals) — both are now handled correctly, disambiguated by whether `requiresQuestId` is present.

6. **Migration 039 + `complete_challenge()` RPC** — fixes a real, confirmed bug: `app/api/quest/challenge/complete/route.ts` used to do a direct client-side `.update()` on `user_challenges`, which migration 019 had silently made a no-op (it removed the UPDATE policy for `authenticated`, and Supabase doesn't error on an RLS-filtered zero-row update). XP was still being awarded correctly, but `status` never actually became `'completed'` — every finished challenge stayed stuck showing `'active'` forever, and anything counting `status = 'completed'` silently undercounted. New SECURITY DEFINER RPC mirrors the existing `complete_daily_quest`/`complete_weekly_quest` pattern and does the status transition + XP award atomically.

7. **Migration 040 — `award_xp()` allowlist + cap.** The most severe finding: `award_xp()` is `GRANT`ed to `authenticated` and has no way to distinguish a legitimate server-route call from a direct browser call using the same session — both use the identical anon-key + cookie client. Before this fix, any authenticated user could call `award_xp` directly with an invented `source_type`/`source_id` and any non-negative `p_xp`, repeatably, for unlimited XP. This migration adds an allowlist of the 10 `source_type` values real code actually uses, and a hard cap (25,000) set above the largest legitimate single award (20,000). **This is a partial mitigation, not a complete fix** — see the caveat immediately below.

8. **Migration 041 — `user_weekly_quests` RLS lockdown.** Unlike `daily_quest_logs` and `user_challenges` (locked down in migration 019), `user_weekly_quests` still had its original `FOR ALL USING (auth.uid() = user_id)` policy — meaning a direct client update really would succeed in setting `status = 'completed'` with an arbitrary `xp_earned`, bypassing everything, including the new requirement checks. This is arguably worse than the challenge bug (there, the open door led to a silent no-op; here, it would have actually worked). Replaced with SELECT-own-rows, INSERT-own-active-row-only, and a narrow UPDATE policy that allows the legitimate "re-accept this week's quest" upsert path but cannot be used to set `status = 'completed'` (the `WITH CHECK` clause rejects it).

9. **Admin UI warnings** — `app/(app)/admin/AdminClient.tsx`'s Badges and Quest Chains tabs now show an explicit banner explaining that entries created there are catalog/display-only and don't drive real unlock logic, linking the gap directly in the product rather than leaving it as a surprise only visible in this document.

### Important caveat on the `award_xp` fix (finding #1)

The allowlist + cap in migration 040 meaningfully raises the bar (an attacker can no longer farm unlimited XP by inventing new `source_type` strings forever), but it does **not** fully close the hole: `award_xp` still has no way to verify that a given `source_id` corresponds to a real event, so a call like `award_xp(self, 'achievement', 'not-a-real-id', 25000)` would still succeed once. The complete fix is architectural — XP-awarding calls need to happen from a **service-role** context the browser can never reach, rather than the anon-key + session client every route currently uses (which is indistinguishable, at the database level, from a call made directly from the browser console). That's a larger, riskier change touching every `createClient()` call site that currently awards XP, and I deliberately didn't attempt it in this pass — it deserves its own focused review rather than being bundled into an audit-fix pass. **This is the top priority for a follow-up security-focused sprint.**

---

## Deliberately not fixed (and why)

- **Unifying the `badges`/`quest_chains` DB tables with their hardcoded code counterparts.** This is a real product/architecture decision (which source of truth should win — should chains become fully DB-driven, or should the DB tables be removed in favor of code-only content?) rather than a bug with one obviously-correct fix. Restructuring it blind, under audit-fix time pressure, risks breaking live content. Flagged with in-product warnings instead; recommend a dedicated design discussion.
- **The `award_xp` service-role migration** described above — correctly scoped as too large/risky for this pass.
- **Admin UI form fields for `requirement_type`/`requirement_value`** on the daily/weekly quest forms in `AdminClient.tsx`. The backend (schema + API validation) is complete and correct — an admin can already set real criteria via a direct API call — but wiring the corresponding dropdown/number-input UI into that ~1,800-line client component was left as a follow-up rather than risking an unfamiliar, large file edit under the same time pressure. This is genuinely just UI polish at this point, not a validation gap.
- **`weekStart`/date-input trustworthiness on `complete_weekly_quest`.** Investigated as a possible exploit (client controls `weekStart`) and confirmed *not* exploitable: the RPC's `WHERE user_id = ... AND week_start = ... AND status = 'active'` guard means a fabricated week only succeeds if the user already has a legitimately-accepted, still-active row for that exact week — there's no way to conjure new XP by inventing dates.

---

## Files changed

**New:**
- `lib/questRequirements.ts`
- `supabase/migrations/038_quest_requirement_criteria.sql` (+ `rollback/038_down.sql`)
- `supabase/migrations/039_complete_challenge_rpc.sql` (+ `rollback/039_down.sql`)
- `supabase/migrations/040_award_xp_allowlist.sql` (+ `rollback/040_down.sql`)
- `supabase/migrations/041_user_weekly_quests_rls_lockdown.sql` (+ `rollback/041_down.sql`)
- `docs/ADMIN_CRUD_AUDIT.md` (this file)

**Modified:**
- `app/api/quest/daily/complete/route.ts` — existence check + requirement validation
- `app/api/quest/weekly/complete/route.ts` — requirement validation
- `app/api/quest/chain/step/route.ts` — requirement validation
- `app/api/quest/challenge/complete/route.ts` — fixed to call `complete_challenge()` RPC instead of the broken direct update
- `app/api/admin/daily-quests/route.ts` — validates/persists `requirement_type`/`requirement_value`
- `app/api/admin/weekly-quests/route.ts` — same
- `lib/quests.ts` — fixed two mismatched `requiresType` values in `QUEST_CHAINS`
- `app/(app)/admin/AdminClient.tsx` — warning banners on Badges and Quest Chains tabs

## Testing note

Same constraint as every prior sprint in this project: no network access in this sandbox, so `npm test`/`next build` couldn't be run. Every modified/new `.ts` file was run through `node --experimental-strip-types --check` (all pass), and a repo-wide grep for the `Map`/`Set` `for...of` pattern that broke an earlier build was re-run — zero matches. **This audit involves real SQL migrations and RLS policy changes — run the full test suite and, ideally, a staging-environment smoke test of accept → complete flows for daily quests, weekly quests, chains, and challenges before deploying.** RLS policy changes in particular are worth manually verifying against a real Supabase instance, since they can't be meaningfully unit-tested outside one.
