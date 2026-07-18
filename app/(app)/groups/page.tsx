import GroupsClient from "./GroupsClient";

export default function GroupsPage() {
  return (
    <div className="max-w-lg mx-auto px-4 pt-6">
      <h1 className="font-display text-2xl font-bold text-white mb-5">Groups</h1>
      <GroupsClient />
    </div>
  );
}
