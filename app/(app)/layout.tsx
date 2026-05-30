import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import BottomNav from "@/components/layout/BottomNav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  return (
    <div className="min-h-screen bg-surface-base flex flex-col">
      <main className="flex-1 pb-24 overflow-y-auto">{children}</main>
      <BottomNav />
    </div>
  );
}
