"use client";

interface Props {
  type: "network" | "server" | "not_found" | "generic";
  onRetry?: () => void;
}

const ERROR_CONTENT = {
  network: {
    emoji: "📡",
    title: "No connection",
    description: "Check your internet and try again. Your data is safe.",
    cta: "Try again",
  },
  server: {
    emoji: "🔧",
    title: "Something went wrong",
    description: "Our servers had a moment. Your progress is saved — please try again.",
    cta: "Try again",
  },
  not_found: {
    emoji: "🗺️",
    title: "Page not found",
    description: "This page doesn't exist. Let's get you back on track.",
    cta: "Go home",
  },
  generic: {
    emoji: "⚡",
    title: "Something's off",
    description: "An unexpected error occurred. Try refreshing the page.",
    cta: "Refresh",
  },
};

export default function ErrorState({ type, onRetry }: Props) {
  const content = ERROR_CONTENT[type];

  function handleAction() {
    if (onRetry) { onRetry(); return; }
    if (type === "not_found") { window.location.href = "/dashboard"; return; }
    window.location.reload();
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] px-6 text-center">
      <div className="text-5xl mb-4">{content.emoji}</div>
      <h3 className="font-display text-xl font-bold text-white mb-2">{content.title}</h3>
      <p className="text-white/40 text-sm mb-6 max-w-xs">{content.description}</p>
      <button onClick={handleAction} className="btn-ghost px-6">
        {content.cta}
      </button>
    </div>
  );
}