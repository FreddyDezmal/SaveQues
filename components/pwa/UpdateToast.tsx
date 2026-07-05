"use client";

/**
 * components/pwa/UpdateToast.tsx
 *
 * Detects a new service worker sitting in "waiting" state and shows a toast
 * offering to update. This is the fast-follow flagged during Sprint 14's
 * review, which set skipWaiting/clientsClaim to false specifically to avoid
 * a deploy silently swapping a live session's network layer mid-use.
 *
 * The update only ever happens when the user explicitly clicks "Update" —
 * there is no automatic/background activation path. This is what
 * "never interrupt active financial operations" means concretely here: a
 * waiting SW just... waits, indefinitely, until this component's button is
 * clicked or the user naturally closes and reopens the app.
 */

import { useEffect, useState, useRef } from "react";
import { RefreshCw, X } from "lucide-react";
import { trackEvent, AnalyticsEvents } from "@/lib/analytics";

export default function UpdateToast() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [updating, setUpdating] = useState(false);
  const shownTracked = useRef(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let reg: ServiceWorkerRegistration | null = null;

    function watchForWaiting(registration: ServiceWorkerRegistration) {
      // Case 1: a SW is already waiting by the time this component mounts
      // (e.g. the deploy happened while the tab was open, or the tab was
      // reopened after a deploy landed while it was closed).
      if (registration.waiting) {
        setWaitingWorker(registration.waiting);
      }

      // Case 2: a new SW starts installing while this tab stays open, and
      // finishes installing (entering "waiting") sometime later.
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            // "installed" + an existing controller means this is an UPDATE,
            // not the very first install on a fresh browser — only the
            // update case should ever prompt the user.
            setWaitingWorker(installing);
          }
        });
      });
    }

    navigator.serviceWorker.getRegistration().then((registration) => {
      if (!registration) return;
      reg = registration;
      watchForWaiting(registration);
    });

    // When the new SW actually takes control (after we post SKIP_WAITING),
    // the page must reload once to guarantee every open tab/request is
    // served by the new version consistently.
    let reloaded = false;
    function handleControllerChange() {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    }
    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
    };
  }, []);

  const visible = waitingWorker !== null && !dismissed;

  useEffect(() => {
    if (visible && !shownTracked.current) {
      shownTracked.current = true;
      trackEvent(AnalyticsEvents.PWA_UPDATE_AVAILABLE_SHOWN);
    }
  }, [visible]);

  if (!visible) return null;

  function handleUpdate() {
    if (!waitingWorker) return;
    setUpdating(true);
    trackEvent(AnalyticsEvents.PWA_UPDATE_INSTALLED);
    // Explicit user action, on this exact click, is what authorizes
    // activation — see the matching listener in app/sw.ts.
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
    // The actual reload is triggered by the `controllerchange` listener
    // above once the new SW finishes taking control, not immediately here —
    // reloading before that would just reload onto the still-old SW.
  }

  return (
    <div
      role="status"
      className="fixed bottom-24 left-4 right-4 z-40 mx-auto max-w-sm rounded-2xl bg-surface-elevated border border-brand-500/20 shadow-lg p-4 flex items-center gap-3 animate-fade-in"
    >
      <div className="w-9 h-9 rounded-xl bg-brand-500/15 flex items-center justify-center flex-shrink-0">
        <RefreshCw size={16} className={`text-brand-400 ${updating ? "animate-spin" : ""}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white">
          {updating ? "Updating…" : "A new version of SaveQuest is available."}
        </p>
      </div>
      {!updating && (
        <>
          <button
            onClick={handleUpdate}
            className="btn-primary text-xs py-1.5 px-3 flex-shrink-0 focus-visible:ring-2 focus-visible:ring-brand-500/50"
          >
            Update
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="text-white/20 hover:text-white/50 transition-colors flex-shrink-0"
            aria-label="Dismiss"
          >
            <X size={15} />
          </button>
        </>
      )}
    </div>
  );
}
