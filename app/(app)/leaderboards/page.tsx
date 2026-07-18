import LeaderboardsClient from "./LeaderboardsClient";

export default function LeaderboardsPage() {
  return (
    <div className="max-w-lg mx-auto px-4 pt-6">
      <h1 className="font-display text-2xl font-bold text-white mb-5">Leaderboards</h1>
      <LeaderboardsClient />
    </div>
  );
}
