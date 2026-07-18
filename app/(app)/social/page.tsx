import Link from "next/link";
import { Users, Users2, Target, Handshake, Trophy, Newspaper, Award, ShieldCheck, ChevronRight } from "lucide-react";

const DESTINATIONS = [
  { href: "/friends", icon: Users, title: "Friends", subtitle: "Requests, search, and your friends list" },
  { href: "/groups", icon: Users2, title: "Groups", subtitle: "Savings groups, quests, and members" },
  { href: "/shared-goals", icon: Target, title: "Shared Goals", subtitle: "Save together toward a goal" },
  { href: "/partner", icon: Handshake, title: "Accountability Partner", subtitle: "Your one-on-one savings partner" },
  { href: "/leaderboards", icon: Trophy, title: "Leaderboards", subtitle: "See how you rank among friends and groups" },
  { href: "/feed", icon: Newspaper, title: "Activity Feed", subtitle: "Milestones from you and your friends" },
  { href: "/achievements", icon: Award, title: "Achievements", subtitle: "Your badges and who can see them" },
  { href: "/social/privacy", icon: ShieldCheck, title: "Privacy", subtitle: "Control who can find and see you" },
] as const;

export default function SocialHubPage() {
  return (
    <div className="max-w-lg mx-auto px-4 pt-6">
      <h1 className="font-display text-2xl font-bold text-white mb-5">Social</h1>
      <div className="space-y-3">
        {DESTINATIONS.map((d) => (
          <Link
            key={d.href}
            href={d.href}
            className="card p-4 flex items-center justify-between hover:border-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-surface-elevated flex items-center justify-center shrink-0" aria-hidden="true">
                <d.icon size={18} className="text-brand-400" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">{d.title}</p>
                <p className="text-xs text-white/40 truncate">{d.subtitle}</p>
              </div>
            </div>
            <ChevronRight size={16} className="text-white/20 shrink-0" aria-hidden="true" />
          </Link>
        ))}
      </div>
    </div>
  );
}
