import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import BillingClient from "./BillingClient";

export default async function BillingPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  return <BillingClient />;
}
