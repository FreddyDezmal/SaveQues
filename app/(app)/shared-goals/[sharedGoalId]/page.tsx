import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import SharedGoalDetailClient from "./SharedGoalDetailClient";

export default function SharedGoalDetailPage({ params }: { params: { sharedGoalId: string } }) {
  return (
    <div className="max-w-lg mx-auto px-4 pt-6">
      <Link href="/shared-goals" className="inline-flex items-center gap-1 text-sm text-white/40 hover:text-white/70 transition-colors mb-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 rounded">
        <ChevronLeft size={16} /> Shared Goals
      </Link>
      <SharedGoalDetailClient sharedGoalId={params.sharedGoalId} />
    </div>
  );
}
