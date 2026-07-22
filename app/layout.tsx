import type { Viewport } from "next";
// @ts-ignore
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import AnalyticsProvider from "@/components/AnalyticsProvider";
import FeatureFlagsProvider from "@/components/FeatureFlagsProvider";
import ExperimentsProvider from "@/components/ExperimentsProvider";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import UpdateToast from "@/components/pwa/UpdateToast";
import { UndoSnackbarProvider } from "@/components/ui/UndoSnackbar";
import InstallSuccessCelebration from "@/components/pwa/InstallSuccessCelebration";
import * as Sentry from "@sentry/nextjs";
import type { Metadata } from "next";

export function generateMetadata(): Metadata {
  return {
    title: "SaveQuest — Level Up Your Savings",
    description: "The gamified savings platform that makes saving money addictive.",
    manifest: "/manifest.json",
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: "SaveQuest",
      // Sprint 14: iOS Safari does not read manifest.json for splash
      // screens the way Android/Chrome does — it needs its own explicit
      // startup images per device size, or it shows a blank white flash
      // on launch instead of a themed splash. Asset generation (the actual
      // PNGs) is a design deliverable, not an engineering one; paths are
      // wired here so drop-in of the real files requires no further code
      // changes.
      startupImage: [
        { url: "/splash/apple-splash-1290x2796.png", media: "(device-width: 430px) and (device-height: 932px)" },
        { url: "/splash/apple-splash-1179x2556.png", media: "(device-width: 393px) and (device-height: 852px)" },
        { url: "/splash/apple-splash-2048x2732.png", media: "(device-width: 1024px) and (device-height: 1366px)" },
      ],
    },
    icons: {
      icon: [
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      // Sprint 14: CHANGED from reusing icon-192.png. iOS ignores
      // manifest.json icons entirely and needs its own dedicated,
      // non-transparent 180x180 asset — reusing a PWA icon that may have
      // transparent padding for its maskable variant risks a black box
      // on the iOS home screen. apple-touch-icon.png is a new asset
      // (design deliverable), referenced here.
      apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
    },
    other: {
      "mobile-web-app-capable": "yes",
      ...Sentry.getTraceData(),
    },
  };
}

export const viewport: Viewport = {
  // Sprint 14: CHANGED from #635bff (purple) to #ffb800, which is the
  // actual --color-brand value defined in globals.css and used throughout
  // the app's buttons and XP bar. #635bff does not appear anywhere else in
  // the codebase — it was never correct. This value drives the Android
  // status bar / task-switcher color and, combined with manifest.json's
  // matching theme_color, the Android splash screen background accent.
  themeColor: "#ffb800",
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  viewportFit: "cover",
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
          {/*
            Sprint 24: evaluated feature flags for this user, fetched once
            from GET /api/feature-flags. Nested inside AnalyticsProvider
            (not the other way around) because it depends on the same
            user?.id but has no bearing on analytics initialisation order.
          */}
          <FeatureFlagsProvider userId={user?.id}>
          <ExperimentsProvider userId={user?.id}>
          {/*
            Sprint 14: registers /sw.js unconditionally on every load.
            Previously the SW was only registered inside the push-notification
            opt-in flow (lib/hooks/useNotifications.ts), so most users never
            got a service worker at all — no install eligibility, no offline
            fallback. This component only registers; it has no effect on
            push subscription behavior, which useNotifications.ts still
            owns entirely.
          */}
          <ServiceWorkerRegistration />
          <UpdateToast />
          <InstallSuccessCelebration />
          <UndoSnackbarProvider>{children}</UndoSnackbarProvider>
          </ExperimentsProvider>
          </FeatureFlagsProvider>
        </AnalyticsProvider>
      </body>
    </html>
  );
}