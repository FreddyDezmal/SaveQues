"use client";

/**
 * components/ErrorBoundary.tsx
 *
 * React error boundary that reports uncaught render errors to Sentry.
 * Wrap any subtree that should be isolated from catastrophic failures.
 *
 * USAGE
 *   <ErrorBoundary fallback={<p>Something went wrong.</p>}>
 *     <MyComponent />
 *   </ErrorBoundary>
 *
 * The Sentry SDK's own <ErrorBoundary> is used under the hood so that
 * componentStack and error metadata are captured automatically.
 */

import { ErrorBoundary as SentryErrorBoundary } from "@sentry/nextjs";
import type { ReactNode } from "react";

interface Props {
  children:  ReactNode;
  fallback?: ReactNode;
}

export default function ErrorBoundary({ children, fallback }: Props) {
  return (
    <SentryErrorBoundary
      fallback={
        fallback ?? (
          <div className="flex flex-col items-center justify-center min-h-[200px] p-8 text-center">
            <div className="text-4xl mb-3">⚠️</div>
            <p className="text-white/60 text-sm">
              Something went wrong. Please refresh the page.
            </p>
          </div>
        )
      }
      showDialog={false}
    >
      {children}
    </SentryErrorBoundary>
  );
}