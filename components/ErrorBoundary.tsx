"use client";

/**
 * components/ErrorBoundary.tsx
 *
 * React error boundary wired to Sentry.
 * Wrap any subtree that should be isolated from catastrophic failures.
 *
 * USAGE
 *   <ErrorBoundary fallback={<p>Something went wrong.</p>}>
 *     <MyComponent />
 *   </ErrorBoundary>
 */

import { ErrorBoundary as SentryErrorBoundary } from "@sentry/nextjs";
import type { ReactElement } from "react";

interface Props {
  children:  React.ReactNode;
  fallback?: ReactElement;
}

const DefaultFallback: ReactElement = (
  <div className="flex flex-col items-center justify-center min-h-[200px] p-8 text-center">
    <div className="text-4xl mb-3">⚠️</div>
    <p className="text-white/60 text-sm">
      Something went wrong. Please refresh the page.
    </p>
  </div>
);

export default function ErrorBoundary({ children, fallback }: Props) {
  return (
    <SentryErrorBoundary fallback={fallback ?? DefaultFallback} showDialog={false}>
      {children}
    </SentryErrorBoundary>
  );
}