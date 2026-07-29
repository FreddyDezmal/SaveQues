"use client";

/**
 * components/goals/ScenarioSimulatorCard.tsx
 * ─────────────────────────────────────────────────────────────
 * Sprint 28 — Phase 8: Scenario Simulator (UI half).
 *
 * Mirrors GoalIntelligenceCard.tsx's philosophy exactly (same file this
 * card sits next to on the goal detail page): compact, collapsed by
 * default, renders nothing when there isn't enough data, text carries the
 * information rather than colour alone. `lib/scenarioSimulator.ts` is
 * pure and never touches real data — this component only ever calls it
 * with local component state, never dispatches a real deposit/withdrawal.
 */

import { useState, useMemo, useCallback } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { simulateScenario, simulateStandardScenarios, type ScenarioResult, type ScenarioType } from "@/lib/scenarioSimulator";
import type { SavingsGoal, Transaction } from "@/lib/types";

interface Props {
  goal: Pick<SavingsGoal, "id" | "target_amount" | "current_amount" | "target_date" | "is_complete">;
  transactions: Transaction[];
  formatAmount: (n: number) => string;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function DeltaBadge({ deltaDays }: { deltaDays: number | null }) {
  if (deltaDays === null) return null;
  if (deltaDays === 0) return <span className="text-xs text-white/40">No change</span>;
  const earlier = deltaDays < 0;
  return (
    <span className={`text-xs font-medium ${earlier ? "text-emerald-400" : "text-amber-400"}`}>
      {earlier ? `${Math.abs(deltaDays)} days earlier` : `${deltaDays} days later`}
    </span>
  );
}

function ScenarioRow({ result, formatAmount }: { result: ScenarioResult; formatAmount: (n: number) => string }) {
  return (
    <li className="py-2.5 border-b border-white/5 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-white/85">{result.label}</span>
        <DeltaBadge deltaDays={result.deltaDays} />
      </div>
      <p className="text-xs text-white/50 mt-0.5">
        {result.insufficientDataReason ?? result.explanation}
      </p>
    </li>
  );
}

export default function ScenarioSimulatorCard({ goal, transactions, formatAmount }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [customType, setCustomType] = useState<ScenarioType>("weekly_delta");
  const [customAmount, setCustomAmount] = useState("");

  const standardScenarios = useMemo(
    () => (expanded ? simulateStandardScenarios(goal, transactions) : []),
    [expanded, goal, transactions]
  );

  const customResult = useMemo(() => {
    const parsed = Number(customAmount);
    if (customAmount === "" || Number.isNaN(parsed)) return null;
    return simulateScenario(goal, transactions, { type: customType, amount: parsed }, new Date());
  }, [customType, customAmount, goal, transactions]);

  const onCustomAmountChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomAmount(e.target.value);
  }, []);

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
        {expanded ? <ChevronUp size={16} className="text-white/40" /> : <ChevronDown size={16} className="text-white/40" />}
      </button>

      {!expanded && (
        <p className="text-xs text-white/50 mt-1">
          Simulate a pace change, a skipped payment, or a lump sum — nothing here changes your real goal.
        </p>
      )}

      {expanded && (
        <div className="mt-3 pt-3 border-t border-surface-border">
          <ul>
            {standardScenarios.map((result) => (
              <ScenarioRow key={result.type + result.label} result={result} formatAmount={formatAmount} />
            ))}
          </ul>

          <div className="mt-3 pt-3 border-t border-surface-border">
            <label htmlFor="scenario-custom-type" className="text-xs text-white/50 block mb-1.5">
              Try your own scenario
            </label>
            <div className="flex gap-2">
              <select
                id="scenario-custom-type"
                value={customType}
                onChange={(e) => setCustomType(e.target.value as ScenarioType)}
                className="flex-1 bg-surface-elevated text-sm text-white/85 rounded-lg px-2.5 py-2 border border-white/10"
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
                className="w-28 bg-surface-elevated text-sm text-white/85 rounded-lg px-2.5 py-2 border border-white/10"
              />
            </div>
            {customResult && (
              <div className="mt-2.5">
                <ScenarioRow result={customResult} formatAmount={formatAmount} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
