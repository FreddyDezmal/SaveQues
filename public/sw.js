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

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const { url, notificationId } = event.notification.data || {};
  const targetUrl = event.action === "dismiss" ? null : (url || "/dashboard");

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
          client.navigate(targetUrl);
          return;
        }
      }
      await self.clients.openWindow(targetUrl);
    })()
  );
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
