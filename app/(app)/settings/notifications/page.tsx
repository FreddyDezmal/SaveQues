import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import NotificationPreferencesClient from "./NotificationPreferencesClient";

export default async function NotificationPreferencesPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  return <NotificationPreferencesClient />;
}
