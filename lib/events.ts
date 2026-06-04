// ============================================================
// SaveQuest Event System
// Handles time-bound quest availability, regionalization,
// lifecycle management, and countdown display
// ============================================================

export type EventType = "seasonal" | "calendar" | "savequest" | "evergreen";
export type EventStatus = "upcoming" | "active" | "completed" | "expired" | "archived";
export type EventRegion = "GLOBAL" | "ZA" | "US" | "GB" | "AU" | "CA" | "NG" | "KE";

export interface SaveQuestEvent {
  id: string;
  title: string;
  description: string;
  emoji: string;
  event_type: EventType;
  xp_reward: number;
  // ISO date strings — null means open-ended
  available_from: string | null;
  available_until: string | null;
  // Regions: ["GLOBAL"] means visible everywhere
  regions: EventRegion[];
  is_active: boolean;
  // Recurring annual events ignore the year
  is_annual: boolean;
  // How many days before start users can preview (but not join)
  preview_days: number;
}

export interface EventWindow {
  status: EventStatus;
  canJoin: boolean;
  // Days until event starts (upcoming only)
  startsInDays?: number;
  // Days until event ends (active only)
  endsInDays?: number;
  // Hours until event ends (active, last 24h)
  endsInHours?: number;
  // Human-readable countdown label
  countdownLabel: string;
  // Urgency level — drives visual treatment
  urgency: "none" | "low" | "medium" | "high" | "critical";
}

// ── CORE AVAILABILITY FUNCTION ────────────────────────────────
export function getEventWindow(
  event: Pick<SaveQuestEvent, "available_from" | "available_until" | "is_annual" | "preview_days">,
  now = new Date()
): EventWindow {
  const { available_from, available_until, is_annual, preview_days } = event;

  // No dates = evergreen, always available
  if (!available_from && !available_until) {
    return {
      status: "active",
      canJoin: true,
      countdownLabel: "",
      urgency: "none",
    };
  }

  const todayMs = now.getTime();
  const year = now.getFullYear();

  // For annual events, slot current year into the dates
  function resolveDate(dateStr: string): Date {
    if (!is_annual) return new Date(dateStr);
    const [, mm, dd] = dateStr.split("-");
    const candidate = new Date(`${year}-${mm}-${dd}`);
    // If already passed this year, use next year
    if (candidate.getTime() < todayMs - 86400000) {
      return new Date(`${year + 1}-${mm}-${dd}`);
    }
    return candidate;
  }

  const startDate = available_from ? resolveDate(available_from) : null;
  const endDate   = available_until ? resolveDate(available_until) : null;

  // End of end date (inclusive — expires at end of the day)
  const endMs = endDate ? endDate.getTime() + 86400000 : Infinity;

  // Expired
  if (endDate && todayMs >= endMs) {
    return { status: "expired", canJoin: false, countdownLabel: "Expired", urgency: "none" };
  }

  // Upcoming
  if (startDate && todayMs < startDate.getTime()) {
    const msUntilStart = startDate.getTime() - todayMs;
    const daysUntil = Math.ceil(msUntilStart / 86400000);

    // Too far away — hide entirely
    if (daysUntil > preview_days) {
      return { status: "upcoming", canJoin: false, countdownLabel: "", urgency: "none" };
    }

    // Within preview window — show as upcoming
    const label = daysUntil === 1 ? "Starts tomorrow" : `Starts in ${daysUntil} days`;
    return {
      status: "upcoming",
      canJoin: false,
      startsInDays: daysUntil,
      countdownLabel: label,
      urgency: daysUntil <= 1 ? "medium" : "low",
    };
  }

  // Active — calculate time remaining
  const msRemaining = endMs === Infinity ? Infinity : endMs - todayMs;
  const daysLeft    = msRemaining === Infinity ? null : Math.ceil(msRemaining / 86400000);
  const hoursLeft   = msRemaining === Infinity ? null : Math.ceil(msRemaining / 3600000);

  let countdownLabel = "";
  let urgency: EventWindow["urgency"] = "none";

  if (daysLeft === null) {
    countdownLabel = "";
    urgency = "none";
  } else if (hoursLeft !== null && hoursLeft <= 24) {
    countdownLabel = hoursLeft <= 1 ? "Ends in less than an hour!" : `Ends in ${hoursLeft} hours`;
    urgency = "critical";
  } else if (daysLeft <= 1) {
    countdownLabel = "Last day!";
    urgency = "critical";
  } else if (daysLeft <= 3) {
    countdownLabel = `${daysLeft} days remaining`;
    urgency = "high";
  } else if (daysLeft <= 7) {
    countdownLabel = `${daysLeft} days remaining`;
    urgency = "medium";
  } else {
    countdownLabel = `${daysLeft} days remaining`;
    urgency = "low";
  }

  return {
    status: "active",
    canJoin: true,
    endsInDays: daysLeft ?? undefined,
    endsInHours: hoursLeft ?? undefined,
    countdownLabel,
    urgency,
  };
}

// ── REGION FILTERING ──────────────────────────────────────────
export function isEventVisibleForRegion(
  eventRegions: EventRegion[],
  userCountry: string
): boolean {
  if (eventRegions.includes("GLOBAL")) return true;
  return eventRegions.includes(userCountry as EventRegion);
}

// ── SORT EVENTS FOR DISPLAY ───────────────────────────────────
// Active > Upcoming > Evergreen
export function sortEventsForDisplay(
  events: (SaveQuestEvent & { window: EventWindow })[]
): (SaveQuestEvent & { window: EventWindow })[] {
  const priority: Record<EventWindow["urgency"], number> = {
    critical: 0,
    high:     1,
    medium:   2,
    low:      3,
    none:     4,
  };

  return [...events].sort((a, b) => {
    // Active before upcoming before evergreen
    const statusOrder: Record<string, number> = { active: 0, upcoming: 1, expired: 2, archived: 3, completed: 4 };
    const sDiff = (statusOrder[a.window.status] ?? 9) - (statusOrder[b.window.status] ?? 9);
    if (sDiff !== 0) return sDiff;
    // Within active: higher urgency first
    return (priority[a.window.urgency] ?? 9) - (priority[b.window.urgency] ?? 9);
  });
}

// ── STATIC EVENT CATALOG ──────────────────────────────────────
// Evergreen and recurring events defined in code.
// One-off campaigns and seasonal events live in the DB.
export const STATIC_EVENTS: SaveQuestEvent[] = [
  {
    id:              "evt_new_year",
    title:           "New Year Savings Kickoff",
    description:     "Start the year right — set a new savings goal and commit.",
    emoji:           "🎆",
    event_type:      "calendar",
    xp_reward:       500,
    available_from:  "2025-01-01",
    available_until: "2025-01-07",
    regions:         ["GLOBAL"],
    is_active:       true,
    is_annual:       true,
    preview_days:    5,
  },
  {
    id:              "evt_black_friday",
    title:           "Black Friday Blackout",
    description:     "The biggest spending day of the year — save instead.",
    emoji:           "🖤",
    event_type:      "calendar",
    xp_reward:       600,
    available_from:  "2025-11-28",
    available_until: "2025-11-30",
    regions:         ["GLOBAL"],
    is_active:       true,
    is_annual:       true,
    preview_days:    7,
  },
  {
    id:              "evt_tax_za",
    title:           "Tax Season Stash",
    description:     "Build your emergency fund during SA tax season.",
    emoji:           "📋",
    event_type:      "seasonal",
    xp_reward:       600,
    available_from:  "2025-02-01",
    available_until: "2025-03-31",
    regions:         ["ZA"],
    is_active:       true,
    is_annual:       true,
    preview_days:    7,
  },
  {
    id:              "evt_school_fees_za",
    title:           "January School Fees Challenge",
    description:     "Save for school fees before January hits.",
    emoji:           "🎒",
    event_type:      "seasonal",
    xp_reward:       500,
    available_from:  "2025-11-01",
    available_until: "2025-12-31",
    regions:         ["ZA"],
    is_active:       true,
    is_annual:       true,
    preview_days:    7,
  },
  {
    id:              "evt_holiday_za",
    title:           "December Holiday Sprint",
    description:     "Save for the holidays before December arrives.",
    emoji:           "🌴",
    event_type:      "seasonal",
    xp_reward:       500,
    available_from:  "2025-10-01",
    available_until: "2025-11-30",
    regions:         ["ZA"],
    is_active:       true,
    is_annual:       true,
    preview_days:    7,
  },
  {
    id:              "evt_back_to_school_us",
    title:           "Back-To-School Savings Challenge",
    description:     "Get ahead of back-to-school expenses.",
    emoji:           "✏️",
    event_type:      "seasonal",
    xp_reward:       400,
    available_from:  "2025-07-15",
    available_until: "2025-08-31",
    regions:         ["US"],
    is_active:       true,
    is_annual:       true,
    preview_days:    7,
  },
  {
    id:              "evt_thanksgiving_us",
    title:           "Thanksgiving Budget Challenge",
    description:     "Save smart through the holiday season.",
    emoji:           "🦃",
    event_type:      "calendar",
    xp_reward:       400,
    available_from:  "2025-11-20",
    available_until: "2025-11-27",
    regions:         ["US"],
    is_active:       true,
    is_annual:       true,
    preview_days:    5,
  },
  {
    id:              "evt_summer_gb",
    title:           "Summer Holiday Savings",
    description:     "Save for your summer holiday before prices rise.",
    emoji:           "☀️",
    event_type:      "seasonal",
    xp_reward:       400,
    available_from:  "2025-05-01",
    available_until: "2025-06-30",
    regions:         ["GB"],
    is_active:       true,
    is_annual:       true,
    preview_days:    7,
  },
  {
    id:              "evt_eofy_au",
    title:           "End of Financial Year Challenge",
    description:     "Maximise your savings before EOFY.",
    emoji:           "📊",
    event_type:      "calendar",
    xp_reward:       600,
    available_from:  "2025-06-01",
    available_until: "2025-06-30",
    regions:         ["AU"],
    is_active:       true,
    is_annual:       true,
    preview_days:    7,
  },
];

// ── GET EVENTS FOR USER ───────────────────────────────────────
export function getEventsForUser(
  userCountry: string,
  now = new Date()
): (SaveQuestEvent & { window: EventWindow })[] {
  const visible = STATIC_EVENTS
    .filter(e => e.is_active && isEventVisibleForRegion(e.regions, userCountry))
    .map(e => ({
      ...e,
      window: getEventWindow(e, now),
    }))
    // Drop events that are too far in future or fully expired
    .filter(e =>
      e.window.status === "active" ||
      (e.window.status === "upcoming" && (e.window.startsInDays ?? 999) <= e.preview_days)
    );

  return sortEventsForDisplay(visible);
}
