"use client";

/**
 * components/onboarding/OnboardingChecklist.tsx
 *
 * First-run checklist shown for new users (userStage === "new").
 * Items auto-update as the user completes actions. When all three
 * are done it shows a celebration state and calls ONBOARDING_COMPLETED.
 *
 * Persistence: completion state is stored in localStorage keyed by userId
 * so the component survives hard refreshes. The onboarding_completed_at
 * timestamp is written to the DB via /api/onboarding/complete.
 */

import { useEffect, useState, useRef } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { trackEvent, AnalyticsEvents } from "@/lib/analytics";

interface ChecklistItem {
  id:    "goal" | "deposit" | "quest";
  label: string;
  icon:  string;
}

const ITEMS: ChecklistItem[] = [
  { id: "goal",    label: "Create your first goal",   icon: "🎯" },
  { id: "deposit", label: "Log your first saving",    icon: "💰" },
  { id: "quest",   label: "Complete today's quest",   icon: "⚡" },
];

interface Props {
  userId: string;
  hasGoal:    boolean;   // at least one savings goal exists
  hasDeposit: boolean;   // at least one transaction exists
  hasQuest:   boolean;   // daily quest completed today
  createdAt:  string;    // profile.created_at ISO string
}

function storageKey(userId: string) {
  return `sq_onboarding_${userId}`;
}

interface PersistedState {
  goal:    boolean;
  deposit: boolean;
  quest:   boolean;
  completedAt?: string;
}

export default function OnboardingChecklist({
  userId, hasGoal, hasDeposit, hasQuest, createdAt,
}: Props) {
  // Merge server-derived truth with local persistence
  const [state, setState] = useState<PersistedState>(() => {
    if (typeof window === "undefined") {
      return { goal: hasGoal, deposit: hasDeposit, quest: hasQuest };
    }
    try {
      const stored = localStorage.getItem(storageKey(userId));
      const parsed: PersistedState = stored ? JSON.parse(stored) : {};
      return {
        goal:    parsed.goal    || hasGoal,
        deposit: parsed.deposit || hasDeposit,
        quest:   parsed.quest   || hasQuest,
        completedAt: parsed.completedAt,
      };
    } catch {
      return { goal: hasGoal, deposit: hasDeposit, quest: hasQuest };
    }
  });

  const completedRef = useRef(false);
  const allDone = state.goal && state.deposit && state.quest;

  // Keep local state in sync when server props change (e.g. after router.refresh)
  useEffect(() => {
    setState(prev => {
      const next: PersistedState = {
        ...prev,
        goal:    prev.goal    || hasGoal,
        deposit: prev.deposit || hasDeposit,
        quest:   prev.quest   || hasQuest,
      };
      try { localStorage.setItem(storageKey(userId), JSON.stringify(next)); } catch {}
      return next;
    });
  }, [hasGoal, hasDeposit, hasQuest, userId]);

  // When all items complete: hit the API once, track analytics
  useEffect(() => {
    if (!allDone || completedRef.current || state.completedAt) return;
    completedRef.current = true;

    const minutesSinceSignup = Math.round(
      (Date.now() - new Date(createdAt).getTime()) / 60000
    );

    fetch("/api/onboarding/complete", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        minutes_since_signup:    minutesSinceSignup,
        goals_created:           1,
        first_deposit_completed: state.deposit,
        first_quest_completed:   state.quest,
      }),
    }).catch(() => {});

    trackEvent(AnalyticsEvents.ONBOARDING_COMPLETED, {
      minutes_since_signup:    minutesSinceSignup,
      goals_created:           1,
      first_deposit_completed: state.deposit,
      first_quest_completed:   state.quest,
    });

    // Stamp local persistence so we don't re-fire
    const next = { ...state, completedAt: new Date().toISOString() };
    setState(next);
    try { localStorage.setItem(storageKey(userId), JSON.stringify(next)); } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone]);

  // Hide once onboarding is marked complete (persisted)
  if (state.completedAt && !allDone) return null;

  const completedCount = [state.goal, state.deposit, state.quest].filter(Boolean).length;

  // ── Celebration state ─────────────────────────────────────────────────────
  if (allDone) {
    return (
      <div className="mb-4 card p-5 border-brand-500/30 bg-brand-500/5 text-center">
        <div className="text-3xl mb-2">🎉</div>
        <p className="font-display font-bold text-white text-sm">{"You're all set!"}</p>
        <p className="text-xs text-white/50 mt-1">
          {"You've completed onboarding — now keep that streak alive."}
        </p>
      </div>
    );
  }


  // ── Active checklist ──────────────────────────────────────────────────────
  return (
    <div className="mb-4 card p-4 border-brand-500/20">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-brand-400 font-bold uppercase tracking-wider">
          Getting Started
        </p>
        <span className="text-xs text-white/40">
          Step {completedCount} of {ITEMS.length} complete
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-surface-border rounded-full mb-4 overflow-hidden">
        <div
          className="h-full bg-brand-500 rounded-full transition-all duration-500"
          style={{ width: `${(completedCount / ITEMS.length) * 100}%` }}
        />
      </div>

      {/* Items */}
      <div className="space-y-2.5">
        {ITEMS.map(item => {
          const done = state[item.id];
          return (
            <div key={item.id} className="flex items-center gap-3">
              {done
                ? <CheckCircle2 size={18} className="text-brand-400 flex-shrink-0" />
                : <Circle       size={18} className="text-white/20 flex-shrink-0" />
              }
              <span className={`text-sm flex-1 ${done ? "text-white/50 line-through" : "text-white/80"}`}>
                {item.icon} {item.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}