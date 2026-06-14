import type { Metadata, Viewport } from "next";
// @ts-ignore
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import AnalyticsProvider from "@/components/AnalyticsProvider";

export const metadata: Metadata = {
  title: "SaveQuest — Level Up Your Savings",
  description: "The gamified savings platform that makes saving money addictive.",
};

export const viewport: Viewport = {
  themeColor: "#0f0f14",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Fetch the session server-side so we can pass userId to the analytics
  // provider. This never blocks rendering — getUser() is cached per-request.
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-body bg-surface-base text-white antialiased min-h-screen">
        {/*
          Pass userId from the server so PostHog can identify the user
          on every page load, not just after a login event.
          userId is undefined for unauthenticated visitors — PostHog
          will track them as anonymous until they log in.
        */}
        <AnalyticsProvider userId={user?.id}>
          {children}
        </AnalyticsProvider>
      </body>
    </html>
  );
}
