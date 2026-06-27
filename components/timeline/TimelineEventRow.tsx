import { format } from "date-fns";
import { formatAmount } from "@/lib/currency";
import { getCategoryById } from "@/lib/utils";
import type { TimelineEvent } from "@/lib/types";

interface Props {
  event: TimelineEvent;
  currencyCode?: string;
  locale?: string;
}

type EventConfig = {
  icon: string;
  label: string;
  iconBg: string;
  iconBorder: string;
  accent?: string;
};

function getEventConfig(event: TimelineEvent, fc: (n: number) => string): EventConfig {
  const { meta } = event;

  switch (meta.type) {
    case "deposit": {
      const cat = getCategoryById(meta.goalCategory);
      return { icon: cat.icon, label: meta.goalTitle, iconBg: "bg-emerald-500/10", iconBorder: "border-emerald-500/20", accent: `+${fc(meta.amount)}` };
    }
    case "withdrawal": {
      const cat = getCategoryById(meta.goalCategory);
      return { icon: cat.icon, label: meta.goalTitle, iconBg: "bg-orange-500/10", iconBorder: "border-orange-500/20", accent: `−${fc(Math.abs(meta.amount))}` };
    }
    case "goal_purchase": {
      return { icon: "🛍️", label: meta.goalTitle, iconBg: "bg-brand-500/10", iconBorder: "border-brand-500/20", accent: fc(Math.abs(meta.amount)) };
    }
    case "goal_created": {
      const cat = getCategoryById(meta.goalCategory);
      return { icon: cat.icon, label: meta.goalTitle, iconBg: "bg-blue-500/10", iconBorder: "border-blue-500/20", accent: fc(meta.targetAmount) };
    }
    case "goal_completed": {
      return { icon: "🏆", label: meta.goalTitle, iconBg: "bg-emerald-500/15", iconBorder: "border-emerald-500/30", accent: fc(meta.targetAmount) };
    }
    case "achievement_earned":
      return { icon: meta.achievementIcon, label: meta.achievementTitle, iconBg: "bg-purple-500/10", iconBorder: "border-purple-500/20", accent: `+${meta.xpReward} XP` };
    case "quest_completed":
      return { icon: "⚔️", label: meta.challengeTitle, iconBg: "bg-brand-500/10", iconBorder: "border-brand-500/20", accent: `+${meta.xpReward} XP` };
    case "progress_milestone": {
      const icons: Record<25 | 50 | 75, string> = { 25: "🌱", 50: "⚡", 75: "🔥" };
      return { icon: icons[meta.milestone], label: meta.goalTitle, iconBg: "bg-emerald-500/10", iconBorder: "border-emerald-500/20", accent: `${meta.milestone}%` };
    }
    default:
      return { icon: "📋", label: "Activity", iconBg: "bg-white/5", iconBorder: "border-white/10" };
  }
}

function getSubLabel(event: TimelineEvent, fc: (n: number) => string): string | null {
  const { meta } = event;
  switch (meta.type) {
    case "deposit":       return meta.note ?? "Deposit";
    case "withdrawal":    return meta.note ?? "Withdrawal";
    case "goal_purchase": return meta.note ?? "Goal purchased";
    case "goal_created":  return `Target: ${fc(meta.targetAmount)}`;
    case "goal_completed": return "Goal reached! 🎉";
    case "achievement_earned": return "Badge unlocked";
    case "quest_completed":    return "Quest complete";
    case "progress_milestone": return `${meta.milestone}% of ${fc(meta.targetAmount)} reached`;
  }
}

function accentClass(type: TimelineEvent["type"]): string {
  switch (type) {
    case "deposit":          return "text-emerald-400";
    case "withdrawal":
    case "goal_purchase":    return "text-orange-400";
    case "goal_completed":   return "text-emerald-400";
    case "achievement_earned":
    case "quest_completed":  return "text-purple-400";
    case "progress_milestone": return "text-emerald-400";
    default:                 return "text-white/40";
  }
}

export default function TimelineEventRow({ event, currencyCode = "ZAR", locale = "en-ZA" }: Props) {
  const fc = (n: number) => formatAmount(n, currencyCode, locale);
  const config = getEventConfig(event, fc);
  const subLabel = getSubLabel(event, fc);
  const time = format(new Date(event.timestamp), "h:mm a");

  return (
    <div className="flex items-center gap-3 py-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 border ${config.iconBg} ${config.iconBorder}`}>
        {config.icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{config.label}</p>
        {subLabel && <p className="text-xs text-white/40 truncate mt-0.5">{subLabel}</p>}
      </div>
      <div className="text-right shrink-0">
        {config.accent && (
          <p className={`text-sm font-semibold font-display ${accentClass(event.type)}`}>{config.accent}</p>
        )}
        <p className="text-[10px] text-white/25 mt-0.5">{time}</p>
      </div>
    </div>
  );
}