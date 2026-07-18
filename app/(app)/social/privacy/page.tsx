import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import PrivacyClient from "./PrivacyClient";

export default function PrivacyPage() {
  return (
    <div className="max-w-lg mx-auto px-4 pt-6">
      <Link href="/social" className="inline-flex items-center gap-1 text-sm text-white/40 hover:text-white/70 transition-colors mb-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 rounded">
        <ChevronLeft size={16} /> Social
      </Link>
      <h1 className="font-display text-2xl font-bold text-white mb-1">Privacy</h1>
      <p className="text-sm text-white/40 mb-5">
        Existing friends and group members keep their own access when you change these — this controls what strangers can find and see by default.
      </p>
      <PrivacyClient />
    </div>
  );
}
