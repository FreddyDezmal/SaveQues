import NotificationBell from "@/components/notifications/NotificationBell";

/**
 * components/layout/AppHeader.tsx
 *
 * There was no header component anywhere in the app prior to Sprint 15 —
 * BottomNav was the only persistent chrome. Introducing a slim top bar is
 * the smallest structural addition that could reasonably host the
 * notification bell (Phase 4) without disturbing any existing page's
 * layout — it's a fixed-height strip added above `children`, not a
 * restructuring of any page.
 */
export default function AppHeader() {
  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between px-4 h-14 bg-surface-base/80 backdrop-blur-md border-b border-surface-border"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)", height: "var(--app-header-height)" }}
    >
      <span className="font-display font-bold text-white text-sm">SaveQuest</span>
      <NotificationBell />
    </header>
  );
}
