"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { GOAL_CATEGORIES } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function NewGoalPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("custom");
  const [targetAmount, setTargetAmount] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase.from("savings_goals").insert({
      user_id: user.id,
      title,
      category,
      target_amount: Number(targetAmount),
      current_amount: 0,
      target_date: targetDate || null,
      is_complete: false,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      // XP is awarded when the first saving is logged to this goal
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
          <p className="text-white/40 text-sm">What are you saving for?</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Category */}
        <div>
          <label className="block text-sm text-white/60 mb-2">Category</label>
          <div className="grid grid-cols-4 gap-2">
            {GOAL_CATEGORIES.map(cat => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategory(cat.id)}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-center transition-all duration-200 ${
                  category === cat.id
                    ? "border-brand-500/60 bg-brand-500/10"
                    : "border-surface-border bg-surface-elevated hover:border-surface-border/80"
                }`}
              >
                <span className="text-xl">{cat.icon}</span>
                <span className="text-[10px] text-white/60 leading-tight">{cat.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Title */}
        <div>
          <label className="block text-sm text-white/60 mb-1.5">Goal Name</label>
          <input
            className="input-field"
            placeholder={`e.g. ${GOAL_CATEGORIES.find(c => c.id === category)?.label ?? "My Goal"}`}
            value={title}
            onChange={e => setTitle(e.target.value)}
            required
          />
        </div>

        {/* Amount */}
        <div>
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
              required
            />
          </div>
        </div>

        {/* Date (optional) */}
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

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? "Creating…" : "Create Goal 🎯"}
        </button>
      </form>
    </div>
  );
}
