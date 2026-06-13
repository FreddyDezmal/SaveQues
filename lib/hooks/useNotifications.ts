"use client";

import { useEffect, useState, useCallback } from "react";

export type NotificationPermission = "default" | "granted" | "denied" | "unsupported";

export type SubscribeError =
  | "permission_denied"
  | "unsupported"
  | "sw_failed"
  | "push_subscribe_failed"
  | "server_failed"
  | "vapid_missing"
  | null;

interface UseNotificationsReturn {
  permission: NotificationPermission;
  isSubscribed: boolean;
  isLoading: boolean;
  error: SubscribeError;
  errorDetail: string | null;
  subscribe: () => Promise<boolean>;
  unsubscribe: () => Promise<boolean>;
}

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw     = window.atob(base64);
  return Uint8Array.from(Array.from(raw).map((c) => c.charCodeAt(0)));
}

function getUserTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; }
  catch { return "UTC"; }
}

/** Wait for SW registration with a timeout so we never hang forever. */
async function registerSW(timeoutMs = 8000): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });

  // If the SW is already active, we're done immediately
  if (navigator.serviceWorker.controller) return reg;

  // Otherwise wait for it to become active, with a timeout
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Service worker activation timed out after 8 s. Check /sw.js is reachable and has no syntax errors."));
    }, timeoutMs);

    function checkState() {
      const sw = reg.installing ?? reg.waiting ?? reg.active;
      if (!sw) { clearTimeout(timer); resolve(reg); return; }

      if (sw.state === "activated") { clearTimeout(timer); resolve(reg); return; }
      if (sw.state === "redundant") {
        clearTimeout(timer);
        reject(new Error("Service worker became redundant — likely a JS error inside /sw.js."));
        return;
      }

      sw.addEventListener("statechange", function handler() {
        sw.removeEventListener("statechange", handler);
        checkState();
      });
    }
    checkState();
  });
}

export function useNotifications(): UseNotificationsReturn {
  const [permission,   setPermission]   = useState<NotificationPermission>("default");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading,    setIsLoading]    = useState(false);
  const [error,        setError]        = useState<SubscribeError>(null);
  const [errorDetail,  setErrorDetail]  = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPermission("unsupported");
      return;
    }

    setPermission(Notification.permission as NotificationPermission);

    // Check existing subscription without hanging — use a short-circuit if no SW active
    if (!navigator.serviceWorker.controller) return;

    navigator.serviceWorker.ready
      .then(async (reg) => {
        const sub = await reg.pushManager.getSubscription();
        setIsSubscribed(!!sub);
      })
      .catch(() => {});
  }, []);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (typeof window === "undefined") return false;

    setError(null);
    setErrorDetail(null);

    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setError("unsupported");
      return false;
    }

    if (!VAPID_PUBLIC_KEY) {
      setError("vapid_missing");
      setErrorDetail("NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set in environment variables.");
      return false;
    }

    setIsLoading(true);
    try {
      // 1. Request notification permission FIRST — this shows the browser prompt.
      //    Do this before SW registration so the user sees the prompt quickly.
      const perm = await Notification.requestPermission();
      setPermission(perm as NotificationPermission);
      if (perm !== "granted") {
        setError("permission_denied");
        return false;
      }

      // 2. Register + activate the service worker
      let registration: ServiceWorkerRegistration;
      try {
        registration = await registerSW();
      } catch (swErr: any) {
        console.error("[notifications] SW registration failed:", swErr);
        setError("sw_failed");
        setErrorDetail(swErr?.message ?? String(swErr));
        return false;
      }

      // 3. Subscribe to push
      let subscription: PushSubscription;
      try {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly:      true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      } catch (pushErr: any) {
        console.error("[notifications] Push subscribe failed:", pushErr);
        setError("push_subscribe_failed");
        setErrorDetail(pushErr?.message ?? String(pushErr));
        return false;
      }

      // 4. Save subscription to server
      const res = await fetch("/api/notifications/subscribe", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          subscription: subscription.toJSON(),
          timezone:     getUserTimezone(),
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        setError("server_failed");
        setErrorDetail(`Server returned ${res.status}: ${body}`);
        return false;
      }

      setIsSubscribed(true);
      return true;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    setErrorDetail(null);
    try {
      if (!navigator.serviceWorker.controller) {
        setIsSubscribed(false);
        return true;
      }
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();

      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await fetch("/api/notifications/unsubscribe", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ endpoint }),
        });
      }

      setIsSubscribed(false);
      return true;
    } catch (err: any) {
      console.error("[notifications] Unsubscribe failed:", err);
      setErrorDetail(err?.message ?? String(err));
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { permission, isSubscribed, isLoading, error, errorDetail, subscribe, unsubscribe };
}
