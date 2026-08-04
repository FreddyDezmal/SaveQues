# Sprint 19 — Intelligence & Financial Insights

## 1. Intelligence Audit (Phase 1)

**Existing data available (no new tables required):**

| Data | Table / source | Notes |
|---|---|---|
| Deposit/withdrawal history | `transactions` (`transaction_type`, `amount`, `goal_id`, `created_at`) | Indexed on `(user_id, created_at DESC)` since migration 024/033 — full history is a single indexed query. |
| Goal history | `savings_goals` | `target_amount`, `current_amount`, `target_date`, `is_complete`. |
| Streak history | `profiles.streak_days` / `longest_streak` | Already computed server-side by `update_streak()`. |
| XP / activity history | `activity_log` (30-day rolling), `profiles.xp_total` | No historical XP *log* — only the running total and a 30-day activity window. This is a real gap (see below). |
| Achievement history | `user_achievements` | `earned_at` per achievement. |
| Notification history | `notifications`-related tables | Not used this sprint — out of scope for savings analytics. |
| Existing analytics | `lib/timeline.ts` | Already builds a full cross-table event stream (deposits, withdrawals, goal lifecycle, achievements, quests, 25/50/75% progress milestones), grouped by date. Reused, not duplicated. |
| Reusable helpers | `lib/dateUtils.ts`, `lib/streaks.ts`, `lib/momentum.ts`, `lib/currency.ts` | UTC date conventions and formatting reused throughout the new modules. |

**Audit finding — documentation/implementation mismatch:** `lib/types.ts`'s `Transaction` row type was missing `transaction_type`, even though that column has existed since migration 014 and is already read by `get_dashboard_data()`, `fetchTimelineEvents()`, and the balance triggers. Per this sprint's instructions, the implementation (the actual column) was treated as the source of truth and the type was corrected (see `lib/types.ts`).

**Gap identified:** there is no `xp_log`/event-sourced ledger of *when* XP was earned or *when* a level-up happened — only `profiles.xp_total` (current) and `activity_log` (30-day rolling XP-per-day). This means:
- Weekly XP totals (Phase 6) are accurate for the current 30-day window.
- A precise "level up" *timestamp* for the journey timeline (Phase 8) can't be reconstructed. `lib/journeyHighlights.ts` documents this gap inline and surfaces the user's *current* level rather than fabricating a level-up date. A future sprint could add an `xp_log` table if historical level-up timestamps become a real product need.

**What could already be calculated vs. what's new:** `lib/timeline.ts` already covered goal lifecycle + achievement/quest events (Phase 8's bulk). Nothing about deposit *statistics* (averages, frequency, consistency, forecasting, health scoring) previously existed anywhere in the codebase — Phases 2–7 are entirely new.

---

## 2. Analytics Architecture (Phase 2)

```
transactions (raw)
      │
      ▼
lib/analyticsEngine.ts   ── pure statistics: averages, buckets, frequency,
      │                     consistency, weekly saving-streaks
      ▼
lib/trends.ts             ── period-over-period comparisons (built on top of
      │                     analyticsEngine, not duplicating its filtering)
      ▼
   ┌──────────────┬──────────────────┬──────────────────┐
   ▼              ▼                  ▼                   ▼
lib/insights.ts  lib/forecast.ts  lib/goalHealth.ts   lib/weeklyReview.ts
   │                  │                  │                   │
   └──────────────────┴────────┬─────────┴───────────────────┘
                                ▼
                        lib/coaching.ts
                                │
                                ▼
                  Dashboard / Goal Detail (Phase 9)
```

Every module above `lib/coaching.ts` is a pure function of `Transaction[]` (+ goal/profile fields) and an optional `now: Date` — no I/O, no hidden state, fully unit-testable. `lib/coaching.ts` is the only module that depends on three others (forecast, goalHealth, analyticsEngine) rather than re-deriving anything.

`lib/journeyHighlights.ts` sits beside (not inside) `lib/timeline.ts` — Phase 8 additions are additive, per "never rewrite working systems."

---

## 3. Files Modified

- `lib/types.ts` — fixed the stale `Transaction` row type (added `transaction_type`), matching the real schema (see audit above).
- `lib/dateUtils.ts` — added `getUTCWeekStartString`, `getUTCMonthString`, `utcDaysBetween`. Extends the existing single-source-of-truth UTC date module rather than introducing a second date convention.
- `app/(app)/dashboard/page.tsx` — added one additional indexed transaction-history query (only for users with `hasDeposit && userStage !== "new"`), and computes insights/weekly review/coaching server-side.
- `app/(app)/dashboard/DashboardClient.tsx` — accepts and renders a new optional `intelligence` prop via `IntelligencePanel`.
- `app/(app)/goals/[id]/GoalDetailClient.tsx` — computes forecast/health/coaching client-side via `useMemo` from data it already has (no new network call), renders `GoalIntelligenceCard`.

## 4. New Files

**Engine (Phases 2–8):**
- `lib/analyticsEngine.ts`
- `lib/trends.ts`
- `lib/insights.ts`
- `lib/forecast.ts`
- `lib/goalHealth.ts`
- `lib/weeklyReview.ts`
- `lib/coaching.ts`
- `lib/journeyHighlights.ts`

**UI (Phase 9):**
- `components/insights/IntelligencePanel.tsx` (dashboard)
- `components/goals/GoalIntelligenceCard.tsx` (goal detail)

**Tests (Phase 11):**
- `tests/unit/analyticsEngine.test.ts`
- `tests/unit/forecast.test.ts`
- `tests/unit/goalHealth.test.ts`
- `tests/unit/insights.test.ts`
- `tests/unit/weeklyReview.test.ts`
- `tests/unit/coaching.test.ts`

**Docs:**
- `docs/SPRINT19_INTELLIGENCE.md` (this file)

---

## 5. Forecasting (Phase 4)

`lib/forecast.ts::forecastGoal()` — deterministic, no ML:

1. **Current pace**: average weekly deposit total over the last 8 weeks *of the goal's own history* (or its full history if younger than 8 weeks), so a brand-new goal isn't diluted by weeks it didn't exist in.
2. **Required pace**: `remaining / weeks_until_target_date` — only computed when a `target_date` exists and hasn't passed.
3. **Pace status**: `ahead` (≥110% of required), `on_track` (90–110%), `behind` (<90%), or `unknown` (missing data).
4. **Projected completion date**: `now + ceil(remaining / currentWeeklyPace weeks)`, or `null` with a stated reason (`insufficientDataReason`) when pace is zero/unknown or there are no deposits yet.
5. **What-if**: `whatIfWeeklyDelta()` re-runs step 4 with an adjusted weekly pace — used for "if you increase deposits by R50/week" style UI (not yet wired into a UI control this sprint; the engine function is ready for Phase 9+ follow-up).

## 6. Goal Health (Phase 5)

`lib/goalHealth.ts::computeGoalHealth()` — five factors, fixed weights, documented in the file header:

| Factor | Max points (with target date) | Max points (no target date) |
|---|---|---|
| Recent activity | 30 | 30 + 6.25 |
| Deposit frequency | 20 | 20 + 6.25 |
| Progress velocity | 25 | 0 |
| Consistency | 15 | 15 + 6.25 |
| Deadline pressure | 10 | 10 + 6.25 |

When there's no `target_date`, "Progress velocity" can't be measured against anything, so its 25 points are redistributed evenly across the other four — the score always totals out of 100 with no unexplained weighting (asserted by `tests/unit/goalHealth.test.ts`). Status bands: **Excellent** 85–100 · **Good** 65–84 · **Needs Attention** 40–64 · **At Risk** 0–39.

## 7. Weekly Review (Phase 6)

`lib/weeklyReview.ts::buildWeeklyReview()` returns a plain data object (not JSX), reusing `analyticsEngine`/`trends` for every number. Same shape is intended to back the dashboard card today and a push notification / PDF / email export later (Phase 6 brief) without recomputation — those integrations are future work, not built this sprint (per the sprint doc, which lists them as "future").

## 8. Coaching Engine (Phase 7)

`lib/coaching.ts` — rule-based templates only, filled from real computed numbers. Every message either: (a) requires a specific minimum amount of supporting data before it fires (e.g. "almost there" only fires when the depositsAway count is 1–3, computed from the actual last-3-deposit average), or (b) is paired with something constructive when reporting inactivity (never a bare "you haven't saved" statement). No random text generation, no LLM calls.

## 9. Timeline / Journey Highlights (Phase 8)

`lib/timeline.ts` (pre-existing) already covers deposits/withdrawals, goal lifecycle, 25/50/75% milestones, achievements, and quests. `lib/journeyHighlights.ts` adds the remaining Phase-8 event kinds (account created, first deposit, first goal, highest deposit, round-number savings milestones, current level) as a separate reusable list — not merged into `TimelineEvent`'s shared union type, to avoid rippling changes into every existing timeline consumer for an additive feature. Not yet wired into a page this sprint (the engine is ready; a `/timeline` UI slot is a natural Phase-9-style follow-up).

## 10. Dashboard Integration (Phase 9)

- **Dashboard**: one new compact card (`IntelligencePanel`) showing the single top insight, the top coaching message, and a one-line "this week vs last week" snapshot. Placed after the existing stat-card row; nothing else on the dashboard was rearranged. Renders nothing when there isn't enough data.
- **Goal detail**: one new collapsible card (`GoalIntelligenceCard`) showing health status/score, top coaching message, and projected completion date, with pace/factor breakdown behind a toggle. Computed via `useMemo` from data the page already fetches — zero additional network calls.

## 11. Performance (Phase 10)

- The only new query is one additional `transactions` select in `app/(app)/dashboard/page.tsx`, gated to users who have at least one deposit and are past the "new" onboarding stage (`hasDeposit && userStage !== "new"`) — new users, who have nothing to analyze, cost nothing extra.
- That query uses the existing `idx_transactions_user_created_at` index (migrations 024/033) — no new index or migration needed.
- Goal-detail intelligence adds **zero** network calls: it's computed client-side via `useMemo` over data the page already fetches (mirrors the existing pattern where that page already loads the goal's full transaction history for the timeline).
- Every `lib/analyticsEngine.ts`/`lib/forecast.ts`/`lib/goalHealth.ts` function is a single pass (or a small constant number of passes) over the deposit array — no nested loops over the full transaction list, no N+1 patterns.
- `get_dashboard_data()` (the RPC) was **not modified** — its single-round-trip guarantee for the base dashboard load is unchanged.

## 12. Security Review

- No new tables, no new RLS policies needed — every new query reuses the existing `transactions` table with its existing `"Users can CRUD own transactions"` RLS policy (`auth.uid() = user_id`), scoped with `.eq("user_id", user.id)` exactly like the pre-existing goal-detail query.
- No new API routes were added; the intelligence layer is pure computation over already-authorized data.
- No financial business rules were touched — deposits/withdrawals/goal purchases still flow through the existing API routes and triggers unchanged.

## 13. Testing (Phase 11)

Unit tests cover `analyticsEngine`, `forecast`, `goalHealth`, `insights`, `weeklyReview`, and `coaching`, following the existing `tests/unit/*.test.ts` + Vitest conventions (see `tests/unit/currency.test.ts` for the established style this sprint followed). Edge cases covered: no transactions, single deposit, large/irregular histories, goals with/without `target_date`, completed goals, stale/inactive goals, tied "favorite day" data (explicitly asserted to *suppress* rather than guess).

**Not executed in this environment** — the sandbox this sprint was built in has no network access, so `npm install` couldn't run and `node_modules` isn't present. Every test was written and manually traced against the implementation, but run `npm test` (or `npm run test:coverage`) in a normal dev/CI environment before merging to confirm.

## 14. Production Readiness Assessment

| Area | Status |
|---|---|
| Deterministic, explainable output | ✅ No ML, no randomness anywhere in the new modules. |
| Evidence-gated (no fabrication) | ✅ Every generator has a documented minimum-data threshold and returns `null`/omits rather than guessing. |
| Performance | ✅ One new indexed query, gated to users with data; goal detail adds none. |
| Security | ✅ Reuses existing RLS-protected queries; no new attack surface. |
| Test coverage | ⚠️ Written, not executed — needs a real `npm test` run in CI before merge. |
| Dashboard/goal UI polish | ⚠️ Functional and on-brand with existing card styles, but not visually reviewed in a running app in this environment — worth a quick design pass. |
| Weekly review notification/PDF/email | 🔜 Explicitly out of scope this sprint (documented as "future" in the brief); the data shape (`WeeklyReview`) is ready for that integration. |
| What-if forecasting UI | 🔜 `whatIfWeeklyDelta()` engine function exists; no UI control wired to it yet. |
| Journey highlights UI | 🔜 `lib/journeyHighlights.ts` engine exists; no dedicated timeline page wiring yet. |

## 15. Sprint Summary

SaveQuest now has a genuine, from-scratch **Intelligence Layer** (Phases 2–7: analytics, insights, forecasting, goal health, weekly review, coaching) sitting on top of data that already existed, plus a small additive extension to the pre-existing timeline (Phase 8). Every number is real, deterministic, and traceable back to the user's own deposit history — insufficient data always means "say nothing," never "guess." The dashboard and goal-detail integrations are intentionally minimal footprints (one new card each) so the core Sprint 18 UX isn't disrupted. The architecture is layered so a future AI-assisted coaching UI could sit on top of `lib/insights.ts` / `lib/coaching.ts`'s structured output without touching the underlying analytics — satisfying the brief's "support future AI enhancements without requiring major refactoring" goal.
