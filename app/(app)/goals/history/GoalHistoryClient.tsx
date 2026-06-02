"use client";

import Link from "next/link";
import { formatAmount } from "@/lib/currency";
import { getCategoryById } from "@/lib/utils";
import { ArrowLeft, Trophy, Plus } from "lucide-react";
import { format, formatDistanceStrict } from "date-fns";

interface Props {
  goals: any[];
  totalLifetimeSaved: number;
  profile: any;
}

export default function GoalHistoryClient({ goals, totalLifetimeSaved, profile }: Props) {
  const currencyCode = profile?.currency_code ?? "ZAR";
  const locale       = profile?.locale ?? "en-ZA";
  const fc = (amount: number) => formatAmount(amount, currencyCode, locale);

  return (
    <div className="max-w-lg mx-auto px-4 pt-6 pb-8">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/goals" className="text-white/40 hover:text-white/70 transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Goal History</h1>
          <p className="text-white/40 text-sm mt-0.5">Every goal you've ever completed</p>
        </div>
      </div>

      {/* Lifetime stats */}
      {goals.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="card p-4 text-center">
            <p className="font-display font-bold text-white text-2xl">{goals.length}</p>
            <p className="text-xs text-white/40 mt-0.5">Goals completed</p>
          </div>
          <div className="card p-4 text-center">
            <p className="font-display font-bold text-white text-xl">{fc(totalLifetimeSaved)}</p>
            <p className="text-xs text-white/40 mt-0.5">Total saved</p>
          </div>
        </div>
      )}

      {/* Completed goal timeline */}
      {goals.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="text-5xl mb-4">🏆</div>
          <h3 className="font-display text-lg font-semibold text-white mb-2">
            Your first completed goal will live here
          </h3>
          <p className="text-white/40 text-sm mb-5">
            Every goal you complete becomes a permanent part of your story.
          </p>
          <Link href="/goals/new" className="btn-primary inline-flex items-center gap-2 text-sm">
            <Plus size={15} /> Create a Goal
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {goals.map((goal, idx) => {
            const category = getCategoryById(goal.category);
            const deposits = (goal.transactions ?? []).filter((t: any) => t.transaction_type === "deposit");
            const totalDeposited = deposits.reduce((s: number, t: any) => s + Number(t.amount), 0);
            const daysToComplete = goal.completed_at && goal.created_at
              ? Math.ceil((new Date(goal.completed_at).getTime() - new Date(goal.created_at).getTime()) / 86400000)
              : null;

            return (
              <div key={goal.id} className="card p-5 border-emerald-500/10">
                {/* Timeline dot */}
                <div className="flex items-start gap-4">
                  <div className="flex flex-col items-center">
                    <div
                      className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl border flex-shrink-0"
                      style={{ backgroundColor: `${category.color}15`, borderColor: `${category.color}30` }}
                    >
                      {goal.goal_emoji || category.icon}
                    </div>
                    {idx < goals.length - 1 && (
                      <div className="w-px flex-1 bg-emerald-500/10 mt-2 mb-0 min-h-[24px]" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0 pb-4">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h3 className="font-display font-bold text-white">{goal.title}</h3>
                      <Trophy size={14} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                    </div>

                    {goal.completed_at && (
                      <p className="text-xs text-emerald-400 mb-2">
                        Completed {format(new Date(goal.completed_at), "d MMMM yyyy")}
                      </p>
                    )}

                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <div className="bg-surface-elevated rounded-xl p-2.5">
                        <p className="text-xs text-white/40 mb-0.5">Saved</p>
                        <p className="font-display font-bold text-white text-sm">{fc(totalDeposited)}</p>
                      </div>
                      {daysToComplete && (
                        <div className="bg-surface-elevated rounded-xl p-2.5">
                          <p className="text-xs text-white/40 mb-0.5">Time taken</p>
                          <p className="font-display font-bold text-white text-sm">
                            {daysToComplete < 30
                              ? `${daysToComplete} days`
                              : `${Math.round(daysToComplete / 30)} months`}
                          </p>
                        </div>
                      )}
                    </div>

                    <p className="text-xs text-white/30">{deposits.length} deposit{deposits.length !== 1 ? "s" : ""} · {category.label}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}