"use client";

/**
 * components/sharing/ShareButton.tsx
 *
 * Wraps navigator.share() with a clipboard fallback for browsers/contexts
 * where it's unavailable (desktop Safari without a share target, Firefox,
 * or simply because the page isn't served over HTTPS in some edge case).
 * Generic by design — takes the share text/title as props — so it can be
 * dropped into CelebrationOverlay (goal completion, achievements, streaks)
 * without that component needing to know which share mechanism is used.
 */

import { useState } from "react";
import { Share2, Copy, Check } from "lucide-react";
import { trackEvent, AnalyticsEvents } from "@/lib/analytics";
import { useHaptics } from "@/lib/hooks/useHaptics";

interface Props {
  title: string;
  text: string;
  /** Context tag for analytics only, e.g. "goal_completion" | "streak" | "achievement" */
  shareContext: string;
  className?: string;
}

export default function ShareButton({ title, text, shareContext, className }: Props) {
  const [copied, setCopied] = useState(false);
  const { vibrate } = useHaptics();

  async function handleShare() {
    trackEvent(AnalyticsEvents.SHARE_INITIATED, { context: shareContext });

    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title, text, url: "https://savequest.app" });
        trackEvent(AnalyticsEvents.SHARE_COMPLETED, { context: shareContext, method: "native" });
        vibrate("light");
        return;
      } catch (err: any) {
        // AbortError = user closed the native share sheet without picking
        // anything — that's a normal cancellation, not a failure, and
        // should NOT fall through to the clipboard fallback (the user
        // explicitly chose not to share).
        if (err?.name === "AbortError") return;
        // Any other error (e.g. share target failed) falls through to the
        // clipboard fallback below rather than leaving the user stuck.
      }
    }

    // Fallback: desktop browsers without navigator.share, or native share failed.
    try {
      await navigator.clipboard.writeText(`${text} https://savequest.app`);
      setCopied(true);
      trackEvent(AnalyticsEvents.SHARE_FALLBACK_COPY, { context: shareContext });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API also unavailable/denied — nothing more we can safely
      // do without a text field for manual copy, which would be
      // disproportionate UI for this button. Fails silently, matching the
      // "gracefully hide/no-op on unsupported" pattern used elsewhere in
      // this sprint (usePWAInstall, useAppBadge).
    }
  }

  return (
    <button
      onClick={handleShare}
      className={`btn-ghost flex items-center justify-center gap-2 text-sm focus-visible:ring-2 focus-visible:ring-white/30 ${className ?? ""}`}
    >
      {copied ? <Check size={15} className="text-emerald-400" /> : <Share2 size={15} />}
      {copied ? "Link copied" : "Share"}
    </button>
  );
}
