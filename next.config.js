/** @type {import('next').NextConfig} */

// ── Service worker build (Sprint 14) ──────────────────────────────────────────
// Compiles app/sw.ts -> public/sw.js at build time, injecting a precache
// manifest of hashed build assets. Disabled in dev so a caching SW never
// intercepts local hot-reload requests. Writes to the SAME path
// (public/sw.js) that the existing push-notification registration code in
// lib/hooks/useNotifications.ts already calls, so that file needs no changes.
const withSerwist = require("@serwist/next").default({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

// ── Environment variable validation ───────────────────────────────────────────
const REQUIRED_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRON_SECRET",
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
];

const missing = REQUIRED_VARS.filter(key => !process.env[key]);

if (missing.length > 0) {
  const list = missing.map(k => `  ✗ ${k}`).join("\n");
  const message = `\n[SaveQuest] Missing required environment variables:\n${list}\n\nCopy .env.local.example → .env.local and fill in the values.\n`;
  if (process.env.NODE_ENV === "production") {
    throw new Error(message);
  } else {
    console.warn("\x1b[33m" + message + "\x1b[0m");
  }
}

const nextConfig = {
  experimental: {
    // Required in Next.js 14 for instrumentation.ts to be loaded
    instrumentationHook: true,
  },

  async headers() {
  // ── Content-Security-Policy ────────────────────────────────────────────
  // Sprint 13 follow-up: closes the gap identified in the production
  // readiness audit (no CSP existed; Sprint 12 report's claim that Vercel
  // provides one by default was incorrect).
  //
  // DEPLOYED IN REPORT-ONLY MODE FIRST. This logs violations to the
  // configured report-uri without blocking anything. Once a few days of
  // production traffic show zero unexpected violations, flip
  // "Content-Security-Policy-Report-Only" to "Content-Security-Policy"
  // below to start enforcing.
  //
  // Domains included:
  //   'self'                  — app's own origin
  //   *.supabase.co           — Supabase API + auth + realtime
  //   us.i.posthog.com        — PostHog client SDK (matches providers/posthog.ts api_host)
  //   *.ingest.sentry.io      — Sentry error reporting (DSN host varies by org)
  //   *.ingest.us.sentry.io   — Sentry's newer US-region ingest host
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://us.i.posthog.com https://us-assets.i.posthog.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://*.supabase.co",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://us.i.posthog.com https://us-assets.i.posthog.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  return [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options",       value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy",        value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy",     value: "camera=(), microphone=(), geolocation=()" },
        // Start as Report-Only. Switch the key below to
        // "Content-Security-Policy" once verified safe in production.
        { key: "Content-Security-Policy", value: csp },
      ],
    },
    {
      source: "/sw.js",
      headers: [
        { key: "Service-Worker-Allowed", value: "/" },
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
      ],
    },
    {
      source: "/manifest.json",
      headers: [
        { key: "Cache-Control", value: "public, max-age=3600, must-revalidate" },
      ],
    },
  ];
},
};

module.exports = withSerwist(nextConfig);