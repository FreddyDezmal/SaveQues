"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Target, Swords, CalendarDays, User } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", icon: Home,          label: "Home"   },
  { href: "/goals",     icon: Target,        label: "Goals"  },
  { href: "/quests",    icon: Swords,        label: "Quests" },
  { href: "/events",    icon: CalendarDays,  label: "Events" },
  { href: "/profile",   icon: User,          label: "Profile"},
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-surface-card/90 backdrop-blur-xl border-t border-surface-border safe-bottom">
      <div className="flex items-center justify-around px-1 pt-2.5 pb-2.5 max-w-lg mx-auto">
        {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center gap-1 px-3 py-1 rounded-xl transition-all duration-200",
                active ? "text-brand-500" : "text-white/30 hover:text-white/60"
              )}
            >
              <Icon
                size={20}
                strokeWidth={active ? 2.5 : 1.75}
                className={cn("transition-all duration-200", active && "drop-shadow-[0_0_8px_rgba(255,184,0,0.5)]")}
              />
              <span className={cn("text-[10px] font-medium transition-all", active && "font-semibold")}>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
