export function getWeekStart(): string {
  const d = new Date();
  const day = d.getDay(); // 0=Sun, 1=Mon...
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(d);
  monday.setDate(diff);
  return monday.toISOString().split("T")[0];
}

export function getDaysIntoWeek(): number {
  const day = new Date().getDay();
  return day === 0 ? 6 : day - 1; // 0=Mon, 6=Sun
}

export function getDaysRemainingInWeek(): number {
  return 6 - getDaysIntoWeek();
}