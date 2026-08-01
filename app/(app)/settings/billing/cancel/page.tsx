import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function CheckoutCancelPage() {
  return (
    <div className="max-w-lg mx-auto px-4 pt-16 pb-8 text-center">
      <h1 className="font-display text-2xl font-bold text-white mb-2">No changes made</h1>
      <p className="text-white/50 text-sm mb-8 max-w-xs mx-auto leading-relaxed">
        Checkout was canceled — you&apos;re still on the Free plan, and nothing was charged.
      </p>
      <Link href="/settings/billing" className="inline-flex items-center gap-2 text-white/60 hover:text-white/90 text-sm">
        <ArrowLeft size={16} aria-hidden="true" />
        Back to Billing
      </Link>
    </div>
  );
}
