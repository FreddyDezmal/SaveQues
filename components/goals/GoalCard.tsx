"use client";

import Link from "next/link";
import { formatCurrency, formatPercent, getDaysRemaining, GOAL_CATEGORIES } from "@/lib/utils";
import type { SavingsGoal } from "@/lib/types";
import { ChevronRight } from "lucide-react";

interface Props {
  goal: SavingsGoal;
  showLink?: boolean;
}

export default function GoalCard({ goal, showLink = true }: Props) {
  const percent = goal.target_amount > 0
    ? (Number(goal.current_amount) / Number(goal.target_amount)) * 100
    : 0;
  const category = GOAL_CATEGORIES.find(c => c.id === goal.category) ?? GOAL_CATEGORIES[GOAL_CATEGORIES.length - 1];
  const daysLeft = goal.target_date ? getDaysRemaining(goal.target_date) : null;
  const isNearComplete = percent >= 90 && !goal.is_complete;

  const content = (
    <div className={`card p-4 transition-all duration-200 hover:border-surface-border/80 ${isNearComplete ? "border-emerald-500/30" : ""}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
            style={{ backgroundColor: `${category.color}18` }}
          >
            {category.icon}
          </div>
          <div>
            <h3 className="font-display font-semibold text-white text-sm leading-tight">{goal.title}</h3>
            <p className="text-xs text-white/40 mt-0.5">
              {formatCurrency(Number(goal.current_amount))} of {formatCurrency(Number(goal.target_amount))}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isNearComplete && (
            <span className="text-[10px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 rounded-full px-2 py-0.5">
              Almost!
            </span>
          )}
          {showLink && <ChevronRight size={16} className="text-white/20" />}
        </div>
      </div>

      {/* Progress bar */}
      <div className="xp-bar-container mb-1.5">
        <div
          className="goal-bar-fill"
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>

      <div className="flex justify-between items-center">
        <span className="text-[11px] text-white/40">{formatPercent(percent)} complete</span>
        {daysLeft !== null && (
          <span className={`text-[11px] ${daysLeft <= 7 ? "text-red-400" : "text-white/30"}`}>
            {daysLeft > 0 ? `${daysLeft}d left` : "Past due"}
          </span>
        )}
      </div>
    </div>
  );

  if (showLink) {
    return <Link href={`/goals/${goal.id}`}>{content}</Link>;
  }
  return content;
}
