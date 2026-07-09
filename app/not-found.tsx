import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-surface-base bg-mesh flex items-center justify-center p-4">
      <div className="text-center max-w-sm">
        <div className="text-6xl mb-4">🗺️</div>
        <h1 className="font-display text-2xl font-bold text-white mb-2">Lost your way?</h1>
        <p className="text-white/50 text-sm mb-6">
          This page doesn&apos;t exist. Your goals and streak are safe — let&apos;s get you back.
        </p>
        <Link href="/dashboard" className="btn-primary inline-block px-6">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}