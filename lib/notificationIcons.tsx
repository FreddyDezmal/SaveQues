/**
 * lib/notificationIcons.tsx
 *
 * Extracted from components/notifications/NotificationCenter.tsx (Sprint
 * 27, Phase 2) so the new full-inbox page (app/(app)/notifications/) can
 * use the exact same icon-per-type mapping instead of a second copy that
 * could quietly drift from the panel's. Kept as its own small .tsx file
 * (not merged into lib/notificationTaxonomy.ts) because it needs
 * lucide-react/JSX — notificationTaxonomy.ts is deliberately React-free
 * so server code (API routes) can import it without pulling in a UI
 * library it'll never render with.
 */
import { Flame, Target, Trophy, Clock, Bell, PartyPopper, BarChart3, Users, Handshake, UserPlus, CalendarClock, PiggyBank, Hourglass } from "lucide-react";
import type { NotificationType } from "@/lib/types.notifications";

export const NOTIFICATION_TYPE_ICON: Record<NotificationType, React.ReactNode> = {
  streak_at_risk: <Flame size={16} className="text-orange-400" />,
  daily_quest: <Target size={16} className="text-brand-400" />,
  weekly_expiry: <Clock size={16} className="text-amber-400" />,
  seasonal_expiry: <Trophy size={16} className="text-purple-400" />,
  inactive: <Bell size={16} className="text-white/40" />,
  achievement_unlocked: <Trophy size={16} className="text-purple-400" />,
  milestone_celebration: <PartyPopper size={16} className="text-emerald-400" />,
  weekly_summary: <BarChart3 size={16} className="text-blue-400" />,
  partner_request: <Handshake size={16} className="text-teal-400" />,
  partner_accepted: <Handshake size={16} className="text-teal-400" />,
  partner_nudge: <Handshake size={16} className="text-teal-400" />,
  partner_reminder: <Handshake size={16} className="text-teal-400" />,
  friend_request: <UserPlus size={16} className="text-pink-400" />,
  friend_accepted: <UserPlus size={16} className="text-pink-400" />,
  group_invite: <Users size={16} className="text-indigo-400" />,
  goal_invitation: <Target size={16} className="text-brand-400" />,
  group_quest_completed: <Trophy size={16} className="text-purple-400" />,
  group_weekly_summary: <BarChart3 size={16} className="text-blue-400" />,
  goal_almost_complete: <Target size={16} className="text-emerald-400" />,
  goal_deadline_approaching: <CalendarClock size={16} className="text-amber-400" />,
  missed_weekly_deposit: <PiggyBank size={16} className="text-amber-400" />,
  group_quest_ending: <Hourglass size={16} className="text-amber-400" />,
  monthly_summary: <BarChart3 size={16} className="text-blue-400" />,
};

export function getNotificationIcon(type: string): React.ReactNode {
  return NOTIFICATION_TYPE_ICON[type as NotificationType] ?? <Bell size={16} className="text-white/40" />;
}
