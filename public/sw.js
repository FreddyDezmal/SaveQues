// SaveQuest Service Worker — Push Notifications

const CACHE_NAME = "savequest-v1";

// ── Install ───────────────────────────────────────────────────────────────────
// Don't block install on caching — if any file is missing the whole SW would
// fail to activate. Cache opportunistically instead.

self.addEventListener("install", (event) => {
  self.skipWaiting();
  // Optionally warm the cache, but never let a 404 kill the SW
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled([
        cache.add("/offline"),
        cache.add("/icons/icon-192.png"),
        cache.add("/icons/badge-72.png"),
      ])
    )
  );
});

// ── Activate ──────────────────────────────────────────────────────────────────

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Push ──────────────────────────────────────────────────────────────────────

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "SaveQuest", body: event.data.text(), type: "unknown" };
  }

  const { title, body, icon, badge, tag, url, notificationId, type } = payload;

  const options = {
    body:  body  || "Check your SaveQuest goals.",
    icon:  icon  || "/icons/icon-192.png",
    badge: badge || "/icons/badge-72.png",
    tag:   tag   || type || "savequest",
    data:  { url: url || "/dashboard", notificationId, type },
    requireInteraction: false,
    renotify: true,
    actions: [
      { action: "open",    title: "Open SaveQuest" },
      { action: "dismiss", title: "Dismiss" },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(title || "SaveQuest", options).then(() => {
      if (notificationId) trackEvent(notificationId, "delivered").catch(() => {});
    })
  );
});

// ── Notification click ────────────────────────────────────────────────────────

// Sprint 27, Phase 14: same-origin relative path check, mirroring
// lib/notificationActions.ts's isSafeRelativePath() — this is a
// separate navigation surface (the service worker's own
// client.navigate()/openWindow() calls) with the identical
// unvalidated-trust gap: targetUrl is server-constructed today (never
// raw user input), but nothing here was actually checking that before
// this phase. Defense-in-depth, not a fix for a known live exploit.
function isSafeRelativePath(url) {
  return typeof url === "string" && url.startsWith("/") && !url.startsWith("//");
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const { url, notificationId } = event.notification.data || {};
  const isDismiss = event.action === "dismiss";
  const requestedUrl = isDismiss ? null : (url || "/dashboard");
  const targetUrl = requestedUrl && isSafeRelativePath(requestedUrl) ? requestedUrl : (isDismiss ? null : "/dashboard");

  event.waitUntil(
    (async () => {
      // Sprint 27, Phase 11: the dismiss action used to just close the
      // notification and return here — never reported, so dismissed_at
      // was always null for every notification ever sent regardless of
      // how many times someone tapped "Dismiss." Fixed: track it like
      // every other outcome.
      if (notificationId) {
        trackEvent(notificationId, isDismiss ? "dismissed" : "clicked").catch(() => {});
      }
      if (!targetUrl) return;

      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          await client.focus();
          client.navigate(targetUrl);
          return;
        }
      }
      await self.clients.openWindow(targetUrl);
    })()
  );
});

// ── Notification close (swipe-away / native "X", not the in-notification
//    "Dismiss" action button above) ─────────────────────────────────────────
//
// Sprint 27, Phase 11: the other half of "Dismissed" tracking. The
// `notificationclose` event fires when a notification goes away WITHOUT
// notificationclick firing at all — e.g. swiped away on mobile, closed via
// the OS notification center's own controls, not tapped. Browser support
// for this event is real but inconsistent (notably: it does not fire for
// notifications closed automatically when the tag is reused via
// `renotify`, and some platforms don't fire it for auto-expired
// notifications at all) — documented honestly in
// docs/SPRINT27_PHASE11_NOTIFICATION_ANALYTICS.md rather than assumed to
// catch every dismiss. It's a real, additive signal, not a complete one.
//
// This DOES also fire after the "Dismiss" action button above calls
// event.notification.close() — harmless double-tracking, not a bug:
// /api/notifications/track's write is idempotent (`.is(column, null)`),
// so the second "dismissed" report for the same notification is a no-op.
self.addEventListener("notificationclose", (event) => {
  const { notificationId } = event.notification.data || {};
  if (notificationId) {
    event.waitUntil(trackEvent(notificationId, "dismissed").catch(() => {}));
  }
});

// ── Push subscription change ──────────────────────────────────────────────────

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.registration.pushManager.subscribe(
      event.oldSubscription ? event.oldSubscription.options : { userVisibleOnly: true }
    ).then((subscription) =>
      fetch("/api/notifications/subscribe", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ subscription }),
      })
    )
  );
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function trackEvent(notificationId, eventType) {
  return fetch("/api/notifications/track", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ notificationId, event: eventType }),
  });
}
