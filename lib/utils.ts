import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatAmount, DEFAULT_CURRENCY, DEFAULT_LOCALE } from "@/lib/currency";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * formatCurrency — backward-compatible wrapper around formatAmount.
 * Components that don't yet have a profile can call this with just an amount.
 * Components with a profile should call formatAmount directly with the
 * user's currency_code and locale for proper internationalisation.
 */
export function formatCurrency(
  amount: number,
  currencyCode = DEFAULT_CURRENCY,
  locale = DEFAULT_LOCALE
): string {
  return formatAmount(amount, currencyCode, locale);
}

export function formatPercent(value: number): string {
  return `${Math.min(100, Math.round(value))}%`;
}

export function getDaysRemaining(targetDate: string): number {
  const target = new Date(targetDate);
  const today = new Date();
  const diff = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

export function getWeeksRemaining(targetDate: string): number {
  return Math.max(0, Math.floor(getDaysRemaining(targetDate) / 7));
}

// ── GOAL CATEGORIES — visual-first ───────────────────────────
export const GOAL_CATEGORIES = [
  { id: "emergency",   label: "Emergency Fund",  icon: "🛡️",  color: "#ef4444", examples: "3-6 months expenses" },
  { id: "travel",      label: "Travel",           icon: "✈️",  color: "#3b82f6", examples: "Flights, hotels, road trips" },
  { id: "gadget",      label: "Gadget",           icon: "💻",  color: "#8b5cf6", examples: "Phone, laptop, PS5" },
  { id: "tuition",     label: "Education",        icon: "🎓",  color: "#f59e0b", examples: "Course, tuition, books" },
  { id: "home",        label: "Home",             icon: "🏠",  color: "#10b981", examples: "Deposit, furniture, repairs" },
  { id: "vehicle",     label: "Vehicle",          icon: "🚗",  color: "#06b6d4", examples: "Car deposit, insurance, service" },
  { id: "fashion",     label: "Fashion",          icon: "👗",  color: "#ec4899", examples: "Clothing, sneakers, accessories" },
  { id: "health",      label: "Health & Fitness", icon: "💪",  color: "#22c55e", examples: "Gym, equipment, medical" },
  { id: "food",        label: "Food & Dining",    icon: "🍽️",  color: "#f97316", examples: "Special dinner, cooking class" },
  { id: "event",       label: "Event / Party",    icon: "🎉",  color: "#a855f7", examples: "Birthday, celebration, festival" },
  { id: "gift",        label: "Gift",             icon: "🎁",  color: "#f43f5e", examples: "Birthday present, Christmas" },
  { id: "custom",      label: "Custom",           icon: "⭐",  color: "#ffb800", examples: "Your own goal" },
] as const;

export type GoalCategory = typeof GOAL_CATEGORIES[number]["id"];

export const GOAL_EMOJIS = [
  "🎮", "✈️", "🚗", "💻", "📱", "🏠", "🎓", "🛡️", "🌍", "🎵",
  "🏋️", "🎂", "💍", "🐾", "⛵", "🎸", "🎨", "🍕", "🎁", "🌟",
  "🏖️", "🎿", "🎯", "🔑", "💼", "🌱", "🏆", "🚀", "💎", "🧳",
];

export function getCategoryById(id: string) {
  return GOAL_CATEGORIES.find(c => c.id === id) ?? GOAL_CATEGORIES[GOAL_CATEGORIES.length - 1];
}

/**
 * Sprint 17 — consolidates two byte-for-byte identical implementations
 * found during the Sprint 17 audit: NotificationCenter.tsx's local
 * `timeAgo()` and useLastSyncedAt.ts's `formatRelativeTime()`. Both took a
 * slightly different input type (ISO string vs. epoch ms) purely by
 * accident of where each was first written, not for any real reason —
 * this accepts either.
 */
export function timeAgo(input: string | number): string {
  const timestamp = typeof input === "string" ? new Date(input).getTime() : input;
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Sprint 28.5 — Phase 13 (Final Review): same situation as Sprint 17's
 * `timeAgo()` above — this consolidates two implementations of the exact
 * same one-line formula (sum of every goal's `current_amount`) found
 * independently in lib/portfolioSummary.ts (`currentSavings`, Sprint 20)
 * and lib/cashFlowProjection.ts (`currentBalance`, Sprint 28), neither
 * aware of the other. Both now call this instead.
 */
export function sumGoalBalances(goals: { current_amount: number | string }[]): number {
  return goals.reduce((sum, g) => sum + Number(g.current_amount), 0);
}
