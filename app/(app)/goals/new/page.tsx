"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { GOAL_CATEGORIES, GOAL_EMOJIS } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

type Step = 1 | 2 | 3;

export default function NewGoalPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("custom");
  const [goalEmoji, setGoalEmoji] = useState("⭐");
  const [targetAmount, setTargetAmount] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const selectedCategory = GOAL_CATEGORIES.find(c => c.id === category) ?? GOAL_CATEGORIES[GOAL_CATEGORIES.length - 1];

  function nextStep() {
    const next = Math.min(3, step + 1) as Step;
    setStep(next);
  }

  async function handleCreate() {
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error: err } = await supabase.from("savings_goals").insert({
      user_id: user.id,
      title,
      category,
      goal_emoji: goalEmoji,
      target_amount: Number(targetAmount),
      current_amount: 0,
      target_date: targetDate || null,
      is_complete: false,
    });

    if (err) {
      setError(err.message);
      setLoading(false);
    } else {
      router.push("/goals");
      router.refresh();
    }
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/goals" className="text-white/40 hover:text-white/70 transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="font-display text-2xl font-bold text-white">New Goal</h1>
          <p className="text-white/40 text-sm">Step {step} of 3</p>
        </div>
      </div>

      <div className="flex gap-1.5 mb-7">
        {[1, 2, 3].map(s => (
          <div key={s} className={`h-1 flex-1 rounded-full transition-all duration-300 ${s <= step ? "bg-brand-500" : "bg-surface-border"}`} />
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-5">
          <div>
            <h2 className="font-display text-xl font-bold text-white mb-1">What are you saving for?</h2>
            <p className="text-white/40 text-sm mb-4">Choose a category</p>
            <div className="grid grid-cols-3 gap-2">
              {GOAL_CATEGORIES.map(cat => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategory(cat.id)}
                  className={`flex flex-col items-center gap-2 p-3 rounded-xl border text-center transition-all duration-200 ${
                    category === cat.id
                      ? "border-brand-500/60 bg-brand-500/10"
                      : "border-surface-border bg-surface-elevated hover:border-white/10"
                  }`}
                >
                  <span className="text-xl">{cat.icon}</span>
                  <span className="text-[10px] text-white/60 leading-tight">{cat.label}</span>
                </button>
              ))}
            </div>
          </div>
          <button type="button" onClick={nextStep} className="btn-primary w-full">Continue →</button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <div>
            <h2 className="font-display text-xl font-bold text-white mb-1">Name your goal</h2>
            <p className="text-white/40 text-sm mb-4">Make it specific and motivating</p>
            <input
              className="input-field"
              placeholder={`e.g. ${selectedCategory.examples}`}
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </div>

          <div>
            <p className="text-sm text-white/60 mb-2">Pick your goal emoji</p>
            <div className="grid grid-cols-8 gap-2">
              {GOAL_EMOJIS.map(emoji => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setGoalEmoji(emoji)}
                  className={`w-10 h-10 rounded-xl text-xl transition-all duration-200 ${
                    goalEmoji === emoji
                      ? "bg-brand-500/20 border-2 border-brand-500/60 scale-110"
                      : "bg-surface-elevated border border-surface-border hover:border-white/20"
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          <div className="card p-4 flex items-center gap-4">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl border"
              style={{ backgroundColor: `${selectedCategory.color}15`, borderColor: `${selectedCategory.color}30` }}
            >
              {goalEmoji}
            </div>
            <div>
              <p className="font-display font-bold text-white">{title || "Your goal name"}</p>
              <p className="text-xs text-white/40 mt-0.5">{selectedCategory.label}</p>
            </div>
          </div>

          <button type="button" onClick={nextStep} disabled={!title} className="btn-primary w-full">
            Continue →
          </button>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-5">
          <div>
            <h2 className="font-display text-xl font-bold text-white mb-1">Set your target</h2>
            <p className="text-white/40 text-sm mb-4">How much do you want to save?</p>

            <div className="mb-4">
              <label className="block text-sm text-white/60 mb-1.5">Target Amount (R)</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 font-display font-medium">R</span>
                <input
                  type="number"
                  className="input-field pl-8"
                  placeholder="0"
                  min="1"
                  value={targetAmount}
                  onChange={e => setTargetAmount(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm text-white/60 mb-1.5">
                Target Date <span className="text-white/30">(optional)</span>
              </label>
              <input
                type="date"
                className="input-field"
                value={targetDate}
                onChange={e => setTargetDate(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
              />
            </div>
          </div>

          <div className="card p-4 border-brand-500/20">
            <p className="text-xs text-white/40 mb-2 uppercase tracking-wider font-medium">Summary</p>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-3xl">{goalEmoji}</span>
              <div>
                <p className="font-display font-bold text-white">{title}</p>
                <p className="text-xs text-white/40">{selectedCategory.label}</p>
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-white/40">Target</span>
                <span className="font-bold text-white">R{targetAmount || "0"}</span>
              </div>
              {targetDate && (
                <div className="flex justify-between text-sm">
                  <span className="text-white/40">Deadline</span>
                  <span className="text-white/70">
                    {new Date(targetDate).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div>
          )}

          <button type="button" onClick={handleCreate} disabled={loading || !targetAmount} className="btn-primary w-full">
            {loading ? "Creating…" : "Create Goal " + goalEmoji}
          </button>
        </div>
      )}
    </div>
  );
}
