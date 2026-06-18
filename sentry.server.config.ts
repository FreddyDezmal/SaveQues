/**
 * sentry.server.config.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sentry SDK initialisation for the Node.js server (API routes, Server
 * Components, Server Actions).
 * Next.js automatically imports this file before any server-side code runs.
 */

import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: SENTRY_DSN,

  enabled: !!SENTRY_DSN,

  environment: process.env.NODE_ENV ?? "development",

  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,

  // Attach deployment info so errors are traceable to a specific release
  release: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.npm_package_version,

  beforeSend(event) {
    // Redact email addresses from error messages
    if (event.exception?.values) {
      for (const ex of event.exception.values) {
        if (ex.value) {
          ex.value = ex.value.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[email]");
        }
      }
    }
    return event;
  },
});