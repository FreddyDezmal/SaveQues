"use client";

import Link from "next/link";
import { formatCurrency, formatPercent, getDaysRemaining, getCategoryById } from "@/lib/utils";
import { ChevronRight } from "lucide-react";

interface Props {
  goal: any;
  showLink?: boolean;
}

export default function GoalCard({ goal, showLink = true }: Props) {
  const percent = goal.target_amount > 0
    ? (Number(goal.current_amount) / Number(goal.target_amount)) * 100
    : 0;
  const category = getCategoryById(goal.category);
  const daysLeft = goal.target_date ? getDaysRemaining(goal.target_date) : null;
  const isNearComplete = percent >= 75 && percent < 100;
  const isComplete = goal.is_complete || percent >= 100;

  const content = (
    <div className={`card p-4 transition-all duration-200 hover:border-white/10 group ${
      isComplete ? "border-emerald-500/20" :
      isNearComplete ? "border-brand-500/20" : ""
    }`}>
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0 border"
          style={{ backgroundColor: `${category.color}15`, borderColor: `${category.color}30` }}
        >
          {goal.goal_emoji || category.icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-semibold text-white text-sm leading-tight truncate">{goal.title}</h3>
          <p className="text-xs text-white/40 mt-0.5">{category.label}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {isComplete && <span className="text-xs text-emerald-400">✅ Done</span>}
          {isNearComplete && !isComplete && (
            <span className="text-[10px] bg-brand-500/15 text-brand-400 border border-brand-500/20 rounded-full px-2 py-0.5">
              Almost!
            </span>
          )}
          {showLink && <ChevronRight size={14} className="text-white/20 group-hover:text-white/40 transition-colors" />}
        </div>
      </div>

      <div className="flex justify-between text-xs mb-2">
        <span className="font-display font-bold text-white">{formatCurrency(Number(goal.current_amount))}</span>
        <span className="text-white/30">of {formatCurrency(Number(goal.target_amount))}</span>
      </div>

      <div className="xp-bar-container mb-1.5">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${isComplete ? "bg-emerald-500" : "goal-bar-fill"}`}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>

      <div className="flex justify-between">
        <span className="text-[11px] font-medium" style={{ color: isComplete ? "#10b981" : "#6b7280" }}>
          {formatPercent(percent)}
        </span>
        {daysLeft !== null && !isComplete && (
          <span className={`text-[11px] ${daysLeft <= 7 ? "text-red-400" : "text-white/30"}`}>
            {daysLeft > 0 ? `${daysLeft}d left` : "Past due"}
          </span>
        )}
      </div>
    </div>
  );

  if (showLink) return <Link href={`/goals/${goal.id}`}>{content}</Link>;
  return content;
}
