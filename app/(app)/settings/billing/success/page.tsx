import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

export default function CheckoutSuccessPage() {
  return (
    <div className="max-w-lg mx-auto px-4 pt-16 pb-8 text-center">
      <div className="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto mb-5">
        <CheckCircle2 size={26} className="text-emerald-400" aria-hidden="true" />
      </div>
      <h1 className="font-display text-2xl font-bold text-white mb-2">You&apos;re on Premium 🎉</h1>
      <p className="text-white/50 text-sm mb-8 max-w-xs mx-auto leading-relaxed">
        Unlimited goals, deeper insights, and AI coaching are unlocked. It may take a few seconds for everything to update.
      </p>
      <Link href="/settings/billing" className="btn-primary inline-flex items-center gap-2 px-6 py-2.5">
        View your plan
      </Link>
    </div>
  );
}
