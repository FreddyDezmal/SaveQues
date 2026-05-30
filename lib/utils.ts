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

export const GOAL_CATEGORIES = [
  { id: "emergency",  label: "Emergency Fund", icon: "🛡️", color: "#ef4444" },
  { id: "travel",     label: "Travel",          icon: "✈️", color: "#3b82f6" },
  { id: "gadget",     label: "Gadget",          icon: "💻", color: "#8b5cf6" },
  { id: "tuition",    label: "Tuition",         icon: "🎓", color: "#f59e0b" },
  { id: "home",       label: "Home",            icon: "🏠", color: "#10b981" },
  { id: "vehicle",    label: "Vehicle",         icon: "🚗", color: "#06b6d4" },
  { id: "custom",     label: "Custom",          icon: "⭐", color: "#ffb800" },
] as const;

export type GoalCategory = typeof GOAL_CATEGORIES[number]["id"];
