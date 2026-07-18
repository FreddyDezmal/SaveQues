import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import FriendsClient from "./FriendsClient";

export default async function FriendsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  return (
    <div className="max-w-lg mx-auto px-4 pt-6">
      <h1 className="font-display text-2xl font-bold text-white mb-5">Friends</h1>
      <FriendsClient />
    </div>
  );
}
