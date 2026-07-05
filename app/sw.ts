// SaveQuest Service Worker (Sprint 14)
//
// This replaces the hand-rolled public/sw.js with a Serwist-managed worker.
// Everything below the `installSerwist(...)` call is the EXISTING push
// notification logic from the previous public/sw.js, copied verbatim with
// zero behavioral changes — push, notificationclick, and
// pushsubscriptionchange all still work exactly as before.
//
// What's new is the runtimeCaching configuration, which is the actual PWA
// offline/caching layer. Rule order matters: Serwist/Workbox evaluates
// runtimeCaching entries top-to-bottom and uses the first match, so the
// financial/auth NetworkOnly deny-list is listed FIRST, before any
// cache-first or stale-while-revalidate rule that could otherwise
// accidentally shadow it.

import { defaultCache } from "@serwist/next/worker";
import { installSerwist } from "@serwist/sw";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";

declare const self: ServiceWorkerGlobalScope &
  SerwistGlobalConfig & { __SW_MANIFEST: (PrecacheEntry | string)[] };

installSerwist({
  precacheEntries: self.__SW_MANIFEST,

  // Sprint 14 review change: skipWaiting/clientsClaim intentionally left at
  // their default of `false` for the initial production rollout.
  //
  // With skipWaiting: true + clientsClaim: true (the original draft), a
  // deploy would cause an ALREADY-OPEN tab to have its network requests
  // taken over by the new SW mid-session, while that tab's in-memory React
  // state, JS chunks, and any in-flight requests were still built against
  // the old deploy. For most apps that's a minor risk; for a financial app
  // mid-transaction, it's not one worth taking for the marginal benefit of
  // slightly faster update propagation.
  //
  // With both left false (Workbox/Serwist's default lifecycle):
  //   - A new SW installs and enters "waiting" state but does NOT activate
  //     while any tab is still controlled by the previous SW.
  //   - It activates once all tabs from the previous version are closed
  //     (e.g. the user fully closes the installed app / all browser tabs
  //     for the origin), or on the next cold start.
  //   - This means a user mid-session never has the rug pulled out from
  //     under them — the version they loaded is the version they keep
  //     until they naturally restart the app.
  //
  // Trade-off, stated plainly: update propagation is slower. A user who
  // keeps a tab open for days won't get a new deploy until they close and
  // reopen. That's an acceptable cost for a financial app; it is NOT
  // acceptable to silently swap the network layer under a live session.
  // If update latency becomes a real problem, the correct fix is an
  // explicit "Update available — reload" UI prompt (listen for the SW's
  // `waiting` state via `registration.waiting`, show a toast, call
  // `postMessage({type: "SKIP_WAITING"})` only on explicit user action) —
  // NOT flipping these flags back to automatic. That is future work, not
  // part of this sprint.
  skipWaiting: false,
  clientsClaim: false,

  navigationPreload: true,

  runtimeCaching: [
    // ── 1. FINANCIAL / AUTH DENY-LIST — must stay first ─────────────────────
    // NetworkOnly means the SW does not read from or write to any cache for
    // these requests, in either direction. This is the rule that keeps
    // deposits, withdrawals, goal mutations, account/profile data, and admin
    // actions from ever being served stale or executed against a queued
    // request. There is no financial mutation path in this app that goes
    // through anything other than these prefixes, so this list is exhaustive
    // against the current API surface (app/api/transactions, app/api/goal,
    // app/api/goals, app/api/account, app/api/profile, app/api/admin).
    {
      matcher: ({ url }: { url: URL }) =>
        url.pathname.startsWith("/api/") &&
        (url.pathname.includes("transaction") ||
          url.pathname.includes("goal") ||
          url.pathname.includes("account") ||
          url.pathname.includes("profile") ||
          url.pathname.includes("admin") ||
          url.pathname.includes("xp") ||
          url.pathname.includes("onboarding")),
      handler: "NetworkOnly",
    },
    {
      matcher: ({ url }: { url: URL }) => url.pathname.startsWith("/auth"),
      handler: "NetworkOnly",
    },

    // ── 2. Read-mostly, non-financial catalog data ──────────────────────────
    // Daily/weekly quest definitions change on admin action, not per user
    // request. Stale-while-revalidate paints instantly from cache and
    // refreshes in the background; capped at 15 minutes so staleness can't
    // compound across a long offline stretch.
    {
      matcher: ({ url }: { url: URL }) =>
        url.pathname === "/api/quest/daily" || url.pathname === "/api/quest/weekly",
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "savequest-quests",
        expiration: { maxAgeSeconds: 60 * 15 },
      },
    },

    // ── 3. Hashed Next.js build assets ──────────────────────────────────────
    // Safe to CacheFirst: the filename itself changes on every deploy
    // (content hash), so a cache hit can never be stale by definition.
    {
      matcher: ({ url }: { url: URL }) => url.pathname.startsWith("/_next/static/"),
      handler: "CacheFirst",
      options: {
        cacheName: "savequest-static",
        expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
      },
    },

    // ── 4. Images ────────────────────────────────────────────────────────────
    {
      matcher: ({ request }: { request: Request }) => request.destination === "image",
      handler: "CacheFirst",
      options: {
        cacheName: "savequest-images",
        expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 14 },
      },
    },

    // ── 5. Serwist's own sane defaults for everything else (fonts, etc.) ────
    ...defaultCache,
  ],

  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher: ({ request }: { request: Request }) => request.destination === "document",
      },
    ],
  },
});

// ─────────────────────────────────────────────────────────────────────────
// EXISTING PUSH NOTIFICATION LOGIC — copied verbatim from public/sw.js.
// No behavioral changes. Preserved exactly so subscription tracking,
// notification click routing, and pushsubscriptionchange refresh all keep
// working without any change to lib/hooks/useNotifications.ts,
// app/api/notifications/subscribe, or app/api/notifications/track.
// ─────────────────────────────────────────────────────────────────────────

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload: any;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "SaveQuest", body: event.data.text(), type: "unknown" };
  }

  const { title, body, icon, badge, tag, url, notificationId, type } = payload;

  const options: NotificationOptions = {
    body: body || "Check your SaveQuest goals.",
    icon: icon || "/icons/icon-192.png",
    badge: badge || "/icons/badge-72.png",
    tag: tag || type || "savequest",
    data: { url: url || "/dashboard", notificationId, type },
    requireInteraction: false,
    renotify: true,
    // @ts-expect-error — `actions` is valid on NotificationOptions at runtime
    // in supporting browsers but not yet in the lib.dom.d.ts NotificationOptions type.
    actions: [
      { action: "open", title: "Open SaveQuest" },
      { action: "dismiss", title: "Dismiss" },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(title || "SaveQuest", options).then(() => {
      if (notificationId) trackEvent(notificationId, "delivered").catch(() => {});
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const { url, notificationId } = event.notification.data || {};
  const targetUrl = event.action === "dismiss" ? null : url || "/dashboard";

  event.waitUntil(
    (async () => {
      if (notificationId && event.action !== "dismiss") {
        trackEvent(notificationId, "clicked").catch(() => {});
      }
      if (!targetUrl) return;

      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          await client.focus();
          // @ts-expect-error — navigate() exists on WindowClient at runtime.
          client.navigate(targetUrl);
          return;
        }
      }
      await self.clients.openWindow(targetUrl);
    })()
  );
});

self.addEventListener("pushsubscriptionchange", (event: any) => {
  event.waitUntil(
    self.registration.pushManager
      .subscribe(event.oldSubscription ? event.oldSubscription.options : { userVisibleOnly: true })
      .then((subscription) =>
        fetch("/api/notifications/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscription }),
        })
      )
  );
});

function trackEvent(notificationId: string, eventType: string) {
  return fetch("/api/notifications/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notificationId, event: eventType }),
  });
}
