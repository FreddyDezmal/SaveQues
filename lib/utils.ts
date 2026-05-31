import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency = "R"): string {
  return `${currency}${amount.toLocaleString("en-ZA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
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

// Visual goal emoji presets — users pick these for their goal card
export const GOAL_EMOJIS = [
  "🎮", "✈️", "🚗", "💻", "📱", "🏠", "🎓", "🛡️", "🌍", "🎵",
  "🏋️", "🎂", "💍", "🐾", "⛵", "🎸", "🎨", "🍕", "🎁", "🌟",
  "🏖️", "🎿", "🎯", "🔑", "💼", "🌱", "🏆", "🚀", "💎", "🧳",
];

export function getCategoryById(id: string) {
  return GOAL_CATEGORIES.find(c => c.id === id) ?? GOAL_CATEGORIES[GOAL_CATEGORIES.length - 1];
}
