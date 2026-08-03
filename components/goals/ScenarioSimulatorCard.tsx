"use client";

/**
 * components/goals/ScenarioSimulatorCard.tsx
 * ─────────────────────────────────────────────────────────────
 * Sprint 28 — Phase 8: Scenario Simulator (UI half).
 * Sprint 30 — Phase 3: Scenario Simulator Upgrade.
 *
 * Mirrors GoalIntelligenceCard.tsx's philosophy exactly (same file this
 * card sits next to on the goal detail page): compact, collapsed by
 * default, renders nothing when there isn't enough data, text carries the
 * information rather than colour alone. `lib/scenarioSimulator.ts` is
 * pure and never touches real data — this component still only ever
 * calls it with local component state, never dispatches a real
 * deposit/withdrawal. Sprint 30 does not change that arithmetic at all
 * (see the Phase 1 audit — don't rebuild what already works); it adds:
 *
 *   1. Enforcing the `scenarios_limit` quota (3/day free, unlimited
 *      premium) that migration 069 seeded but nothing ever checked —
 *      each "run" (opening the panel, or submitting a custom scenario)
 *      now calls POST /api/goal/scenario-run first. The custom-scenario
 *      field used to auto-simulate on every keystroke; it's now an
 *      explicit "Run" button, because a meaningful usage cap needs a
 *      discrete action to gate, not a live recompute.
 *   2. Saved scenarios (genuinely new — see migration
 *      070_scenario_simulator_premium.sql): free users can save 1 per
 *      goal, premium unlimited. Saved scenarios re-simulate against the
 *      goal's current transactions on load (the table stores the input,
 *      not a frozen result) and slot into the exact same ScenarioBar
 *      comparison Sprint 28.5 already built — not a second comparison
 *      view.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Bookmark, Trash2 } from "lucide-react";
import { simulateScenario, simulateStandardScenarios, type ScenarioResult, type ScenarioType } from "@/lib/scenarioSimulator";
import UpgradePrompt from "@/components/billing/UpgradePrompt";
import type { SavingsGoal, Transaction } from "@/lib/types";

interface Props {
  goal: Pick<SavingsGoal, "id" | "target_amount" | "current_amount" | "target_date" | "is_complete">;
  transactions: Transaction[];
  formatAmount: (n: number) => string;
}

interface SavedScenarioRow {
  id: string;
  goal_id: string;
  scenario_type: ScenarioType;
  amount: number | null;
  interval_days: number | null;
  label: string;
  created_at: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function DeltaBadge({ deltaDays }: { deltaDays: number | null }) {
  if (deltaDays === null) return null;
  if (deltaDays === 0) return <span className="text-xs text-white/55">No change</span>;
  const earlier = deltaDays < 0;
  return (
    <span className={`text-xs font-medium ${earlier ? "text-emerald-400" : "text-amber-400"}`}>
      {earlier ? `${Math.abs(deltaDays)} days earlier` : `${deltaDays} days later`}
    </span>
  );
}

/**
 * Sprint 28.5 — Phase 6: "Scenario comparison" visualization. A centered
 * bar showing each scenario's deltaDays relative to the largest delta in
 * the current comparison set — lets a user see at a glance which what-if
 * moves the needle most, something the text-only rows below don't give
 * you without reading and mentally comparing every number.
 *
 * Sprint 30 — Phase 3: unchanged. Saved scenarios are folded into the
 * same `maxAbsDelta` scale as the standard four (see the parent
 * component's `maxAbsDelta` memo below), so this bar is still the one
 * comparison surface for every scenario shown on the page — not a
 * second, premium-only comparison chart.
 *
 * aria-hidden: purely a visual reinforcement of `DeltaBadge`'s text
 * ("14 days earlier") sitting right next to it — same "don't make a
 * screen reader announce the same fact twice" reasoning as the momentum
 * heatmap's grid (see that component's own comment).
 */
function ScenarioBar({ deltaDays, maxAbsDelta }: { deltaDays: number | null; maxAbsDelta: number }) {
  if (deltaDays === null || deltaDays === 0 || maxAbsDelta === 0) return null;
  const earlier = deltaDays < 0;
  const widthPct = Math.min(100, (Math.abs(deltaDays) / maxAbsDelta) * 100);
  return (
    <div aria-hidden="true" className="h-1.5 rounded-full bg-white/5 mt-1.5 flex" style={{ direction: earlier ? "rtl" : "ltr" }}>
      <div
        className={`h-full rounded-full ${earlier ? "bg-emerald-400" : "bg-amber-400"}`}
        style={{ width: `${widthPct}%` }}
      />
    </div>
  );
}

function ScenarioRow({
  result, maxAbsDelta, onSave, saveDisabled,
}: {
  result: ScenarioResult;
  maxAbsDelta?: number;
  onSave?: () => void;
  saveDisabled?: boolean;
}) {
  return (
    <li className="py-2.5 border-b border-white/5 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-white/85">{result.label}</span>
        <div className="flex items-center gap-2 flex-shrink-0">
          <DeltaBadge deltaDays={result.deltaDays} />
          {onSave && (
            <button
              type="button"
              onClick={onSave}
              disabled={saveDisabled}
              aria-label={`Save scenario: ${result.label}`}
              title="Save this scenario"
              className="text-white/35 hover:text-amber-300 disabled:opacity-30 disabled:hover:text-white/35 p-1 -m-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50"
            >
              <Bookmark size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {maxAbsDelta !== undefined && <ScenarioBar deltaDays={result.deltaDays} maxAbsDelta={maxAbsDelta} />}
      <p className="text-xs text-white/50 mt-0.5">
        {result.insufficientDataReason ?? result.explanation}
      </p>
    </li>
  );
}

function SavedScenarioRow({
  saved, result, maxAbsDelta, onDelete,
}: {
  saved: SavedScenarioRow;
  result: ScenarioResult | null;
  maxAbsDelta: number;
  onDelete: () => void;
}) {
  return (
    <li className="py-2.5 border-b border-white/5 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-white/85">{saved.label}</span>
        <div className="flex items-center gap-2 flex-shrink-0">
          {result && <DeltaBadge deltaDays={result.deltaDays} />}
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Remove saved scenario: ${saved.label}`}
            title="Remove"
            className="text-white/35 hover:text-red-300 p-1 -m-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50"
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      {result && <ScenarioBar deltaDays={result.deltaDays} maxAbsDelta={maxAbsDelta} />}
      <p className="text-xs text-white/50 mt-0.5">
        {result ? (result.insufficientDataReason ?? result.explanation) : "Recalculating…"}
      </p>
    </li>
  );
}

export default function ScenarioSimulatorCard({ goal, transactions, formatAmount }: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [customType, setCustomType] = useState<ScenarioType>("weekly_delta");
  const [customAmount, setCustomAmount] = useState("");
  const [customResult, setCustomResult] = useState<ScenarioResult | null>(null);
  const [customRunning, setCustomRunning] = useState(false);

  // Sprint 30 — Phase 3: quota state. `null` = not checked yet this
  // expand. A block response carries the exact upgrade-worthy message
  // the server already composed (enforceUsageLimit's JSON body) rather
  // than a second, possibly-inconsistent client-side copy of it.
  const [runBlocked, setRunBlocked] = useState<{ message: string; limit: number | null; used: number | null } | null>(null);
  const [standardScenarios, setStandardScenarios] = useState<ScenarioResult[]>([]);
  const [checkingQuota, setCheckingQuota] = useState(false);

  const [savedScenarios, setSavedScenarios] = useState<SavedScenarioRow[]>([]);
  const [savedResults, setSavedResults] = useState<Record<string, ScenarioResult>>({});
  const [saveBlocked, setSaveBlocked] = useState<{ message: string; limit: number | null; used: number | null } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  // Re-simulate every saved scenario against the goal's CURRENT
  // transactions whenever either changes — the table stores the input,
  // never a frozen result (see migration 070's comment), so this is the
  // one place saved scenarios are actually computed, reusing the exact
  // same simulateScenario() the standard/custom rows use.
  useEffect(() => {
    const next: Record<string, ScenarioResult> = {};
    for (const s of savedScenarios) {
      next[s.id] = simulateScenario(
        goal,
        transactions,
        { type: s.scenario_type, amount: s.amount ?? undefined, intervalDays: s.interval_days ?? undefined },
        new Date(),
        formatAmount
      );
    }
    setSavedResults(next);
    // formatAmount deliberately omitted — it's a fresh inline function
    // identity on every parent render (see PremiumForecastCard's callers
    // for the same shape), so depending on it would re-run this effect
    // every render rather than only when the underlying data changes.
    // Only used for label text, which is re-derived from goal/transactions
    // anyway whenever this effect legitimately re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedScenarios, goal, transactions]);

  // Load saved scenarios once the card is expanded — no need to fetch
  // for a goal detail page the user never opens the panel on.
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    fetch(`/api/goal/scenario-saved?goal_id=${goal.id}`)
      .then((r) => (r.ok ? r.json() : { scenarios: [] }))
      .then((data) => {
        if (!cancelled) setSavedScenarios(data.scenarios ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [expanded, goal.id]);

  // Sprint 30 — Phase 3: check/record the scenarios_limit quota once per
  // expand, then compute the standard four scenarios only if allowed.
  // Fails open on a network error (same reasoning as every fail-open
  // count-query swallow elsewhere in the billing layer) — a temporary
  // API hiccup shouldn't block a free feature that already exists.
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    setCheckingQuota(true);
    fetch("/api/goal/scenario-run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal_id: goal.id }),
    })
      .then(async (r) => {
        if (cancelled) return;
        if (r.status === 403) {
          const body = await r.json().catch(() => null);
          setRunBlocked({ message: body?.error ?? "You've reached your plan's daily scenario limit.", limit: body?.limit ?? null, used: body?.used ?? null });
          setStandardScenarios([]);
          return;
        }
        setRunBlocked(null);
        setStandardScenarios(simulateStandardScenarios(goal, transactions, new Date(), formatAmount));
      })
      .catch(() => {
        if (!cancelled) setStandardScenarios(simulateStandardScenarios(goal, transactions, new Date(), formatAmount));
      })
      .finally(() => {
        if (!cancelled) setCheckingQuota(false);
      });
    return () => {
      cancelled = true;
    };
    // Deliberately re-runs only when the panel is (re-)expanded, not on
    // every transactions/goal change — re-expanding is the "run" action;
    // background data refreshes shouldn't silently spend quota.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, goal.id]);

  const maxAbsDelta = useMemo(() => {
    const all = [...standardScenarios, ...Object.values(savedResults), ...(customResult ? [customResult] : [])];
    return Math.max(0, ...all.map((r) => Math.abs(r.deltaDays ?? 0)));
  }, [standardScenarios, savedResults, customResult]);

  const onCustomAmountChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomAmount(e.target.value);
    setCustomResult(null);
  }, []);

  const runCustomScenario = useCallback(async () => {
    const parsed = Number(customAmount);
    if (customAmount === "" || Number.isNaN(parsed)) return;

    setCustomRunning(true);
    try {
      const res = await fetch("/api/goal/scenario-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal_id: goal.id }),
      });
      if (res.status === 403) {
        const body = await res.json().catch(() => null);
        setRunBlocked({ message: body?.error ?? "You've reached your plan's daily scenario limit.", limit: body?.limit ?? null, used: body?.used ?? null });
        return;
      }
      setRunBlocked(null);
      setCustomResult(simulateScenario(goal, transactions, { type: customType, amount: parsed }, new Date(), formatAmount));
    } catch {
      // Fail open — same reasoning as the standard-scenario quota check above.
      setCustomResult(simulateScenario(goal, transactions, { type: customType, amount: parsed }, new Date(), formatAmount));
    } finally {
      setCustomRunning(false);
    }
  }, [customAmount, customType, goal, transactions]);

  const saveScenario = useCallback(
    async (result: ScenarioResult, amount?: number, intervalDays?: number) => {
      setSaveBlocked(null);
      setSavingId(result.type + result.label);
      try {
        const res = await fetch("/api/goal/scenario-saved", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            goal_id: goal.id,
            scenario_type: result.type,
            amount: amount ?? null,
            interval_days: intervalDays ?? null,
            label: result.label,
          }),
        });
        if (res.status === 403) {
          const body = await res.json().catch(() => null);
          setSaveBlocked({ message: body?.error ?? "You've reached your plan's saved-scenario limit.", limit: body?.limit ?? null, used: body?.used ?? null });
          return;
        }
        if (res.ok) {
          const body = await res.json();
          setSavedScenarios((prev) => [...prev, body.scenario]);
        }
      } finally {
        setSavingId(null);
      }
    },
    [goal.id]
  );

  const deleteSaved = useCallback(async (id: string) => {
    setSavedScenarios((prev) => prev.filter((s) => s.id !== id));
    try {
      await fetch(`/api/goal/scenario-saved?id=${id}`, { method: "DELETE" });
    } catch {
      // Optimistic removal already happened; a failed delete just means
      // it reappears on the next expand's fetch, not a broken UI now.
    }
  }, []);

  const goToBilling = useCallback(() => router.push("/settings/billing"), [router]);

  if (goal.is_complete) return null;

  return (
    <div className="card p-4 mb-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between"
        aria-expanded={expanded}
      >
        <span className="text-sm font-semibold text-white/90">What if…</span>
        {expanded ? <ChevronUp size={16} className="text-white/40" aria-hidden="true" /> : <ChevronDown size={16} className="text-white/40" aria-hidden="true" />}
      </button>

      {!expanded && (
        <p className="text-xs text-white/50 mt-1">
          Simulate a pace change, a skipped payment, or a lump sum — nothing here changes your real goal.
        </p>
      )}

      {expanded && (
        <div className="mt-3 pt-3 border-t border-surface-border">
          {runBlocked ? (
            <UpgradePrompt
              message={runBlocked.message}
              usageDetail={runBlocked.limit !== null && runBlocked.used !== null ? `${runBlocked.used} of ${runBlocked.limit} simulations used today` : undefined}
              onUpgradeClick={goToBilling}
              className="mb-3"
            />
          ) : (
            <ul aria-busy={checkingQuota}>
              {standardScenarios.map((result) => (
                <ScenarioRow
                  key={result.type + result.label}
                  result={result}
                  maxAbsDelta={maxAbsDelta}
                  onSave={() => saveScenario(result)}
                  saveDisabled={savingId === result.type + result.label}
                />
              ))}
            </ul>
          )}

          {savedScenarios.length > 0 && (
            <div className="mt-3 pt-3 border-t border-surface-border">
              <p className="text-xs text-white/50 mb-1.5">Saved scenarios</p>
              <ul>
                {savedScenarios.map((s) => (
                  <SavedScenarioRow
                    key={s.id}
                    saved={s}
                    result={savedResults[s.id] ?? null}
                    maxAbsDelta={maxAbsDelta}
                    onDelete={() => deleteSaved(s.id)}
                  />
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3 pt-3 border-t border-surface-border">
            <label htmlFor="scenario-custom-type" className="text-xs text-white/50 block mb-1.5">
              Try your own scenario
            </label>
            <div className="flex gap-2">
              <select
                id="scenario-custom-type"
                value={customType}
                onChange={(e) => {
                  setCustomType(e.target.value as ScenarioType);
                  setCustomResult(null);
                }}
                className="flex-1 bg-surface-elevated text-sm text-white/85 rounded-lg px-2.5 py-2 border border-white/10 focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
              >
                <option value="weekly_delta">Change weekly deposit by</option>
                <option value="lump_sum">Add a one-time lump sum of</option>
              </select>
              <input
                type="number"
                inputMode="decimal"
                value={customAmount}
                onChange={onCustomAmountChange}
                placeholder="Amount"
                aria-label="Scenario amount"
                className="w-24 bg-surface-elevated text-sm text-white/85 rounded-lg px-2.5 py-2 border border-white/10 focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
              />
              <button
                type="button"
                onClick={runCustomScenario}
                disabled={customAmount === "" || customRunning}
                className="btn-ghost text-sm px-3 py-2 min-h-[40px] disabled:opacity-40"
              >
                {customRunning ? "Running…" : "Run"}
              </button>
            </div>
            {customResult && (
              <div className="mt-2.5">
                <ScenarioRow
                  result={customResult}
                  onSave={() => saveScenario(customResult, Number(customAmount))}
                  saveDisabled={savingId === customResult.type + customResult.label}
                />
              </div>
            )}
          </div>

          {saveBlocked && (
            <UpgradePrompt
              message={saveBlocked.message}
              usageDetail={saveBlocked.limit !== null && saveBlocked.used !== null ? `${saveBlocked.used} of ${saveBlocked.limit} saved scenarios used for this goal` : undefined}
              onUpgradeClick={goToBilling}
              className="mt-3"
            />
          )}
        </div>
      )}
    </div>
  );
}
