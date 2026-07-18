import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import GroupDetailClient from "./GroupDetailClient";

export default function GroupDetailPage({ params }: { params: { groupId: string } }) {
  return (
    <div className="max-w-lg mx-auto px-4 pt-6">
      <Link href="/groups" className="inline-flex items-center gap-1 text-sm text-white/40 hover:text-white/70 transition-colors mb-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 rounded">
        <ChevronLeft size={16} /> Groups
      </Link>
      <GroupDetailClient groupId={params.groupId} />
    </div>
  );
}
