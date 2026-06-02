export type QuestAvailability =
  | "available"       // can be accepted now
  | "upcoming"        // visible, starts in future, cannot accept yet
  | "expired"         // past end date
  | "always_on"       // evergreen, always available
  | "completed";      // user already completed it

export interface QuestWindow {
  availability: QuestAvailability;
  startsIn?: number;   // days until available
  endsIn?: number;     // days until expiry (shown when <= 7)
  label?: string;      // "Starts in 3 days" / "Ends tomorrow" / "Active now"
}

export function getQuestAvailability(
  quest: {
    quest_type: string;
    start_date: string | null;
    end_date: string | null;
    year_agnostic: boolean;
    preview_days: number;
  },
  today = new Date()
): QuestWindow {
  // Evergreen — always available
  if (quest.quest_type === "evergreen" || (!quest.start_date && !quest.end_date)) {
    return { availability: "always_on" };
  }

  const todayStr = today.toISOString().split("T")[0];

  // For year_agnostic events, substitute current year into the dates
  let startDate = quest.start_date;
  let endDate   = quest.end_date;

  if (quest.year_agnostic && startDate && endDate) {
    const year = today.getFullYear();
    startDate = `${year}-${startDate.slice(5)}`;
    endDate   = `${year}-${endDate.slice(5)}`;

    // If the event has already passed this year, show next year's
    if (endDate < todayStr) {
      startDate = `${year + 1}-${quest.start_date!.slice(5)}`;
      endDate   = `${year + 1}-${quest.end_date!.slice(5)}`;
    }
  }

  if (!startDate || !endDate) return { availability: "always_on" };

  const msPerDay = 86400000;
  const todayMs = today.getTime();
  const startMs = new Date(startDate).getTime();
  const endMs   = new Date(endDate).getTime() + msPerDay; // end date is inclusive

  // Expired
  if (todayMs > endMs) {
    return { availability: "expired" };
  }

  // Upcoming (within preview window)
  const daysUntilStart = Math.ceil((startMs - todayMs) / msPerDay);
  if (todayMs < startMs) {
    if (daysUntilStart <= quest.preview_days) {
      return {
        availability: "upcoming",
        startsIn: daysUntilStart,
        label: daysUntilStart === 1
          ? "Starts tomorrow"
          : `Starts in ${daysUntilStart} days`,
      };
    }
    // Too far in future — don't show yet
    return { availability: "expired" }; // hidden state
  }

  // Active — check how many days left
  const daysLeft = Math.ceil((endMs - todayMs) / msPerDay);
  return {
    availability: "available",
    endsIn: daysLeft,
    label: daysLeft === 1
      ? "Last day!"
      : daysLeft <= 7
      ? `${daysLeft} days left`
      : undefined,
  };
}

export function isQuestAcceptable(window: QuestWindow): boolean {
  return window.availability === "available" || window.availability === "always_on";
}