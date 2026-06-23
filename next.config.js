/** @type {import('next').NextConfig} */

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
    // ── Content Security Policy ───────────────────────────────────────────
    // Sprint 12 independent audit recommendation: a CSP limits the blast
    // radius of any future XSS vulnerability by restricting which scripts,
    // styles, and connections the browser will execute/accept.
    //
    // This is a PERMISSIVE starting CSP designed to not break any existing
    // functionality — it is not maximally restrictive. It closes the
    // most-impactful XSS categories (no inline scripts from injected content,
    // no arbitrary script sources) while allowing the specific origins
    // SaveQuest legitimately uses.
    //
    // IMPORTANT: 'unsafe-inline' for style-src is required for Tailwind's
    // inline styles (used throughout the app). Do NOT remove it without
    // first auditing every inline style usage. 'unsafe-eval' is NOT
    // included — nothing in the app legitimately requires eval().
    //
    // Next.js adds nonces automatically in future versions; this CSP
    // does not use nonces yet (requires a middleware change) — but the
    // baseline script-src without 'unsafe-inline' already prevents
    // most XSS-injected script execution.
    const supabaseHost = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
      .replace("https://", "")
      .split("/")[0];

    const csp = [
      `default-src 'self'`,
      `script-src 'self' https://app.posthog.com`,
      `style-src 'self' 'unsafe-inline'`,
      `img-src 'self' data: blob:`,
      `font-src 'self'`,
      `connect-src 'self' https://${supabaseHost} https://app.posthog.com https://sentry.io wss://${supabaseHost}`,
      `frame-src 'none'`,
      `object-src 'none'`,
      `base-uri 'self'`,
      `form-action 'self'`,
      `worker-src 'self' blob:`,
    ].join("; ");

    return [
      {
        // Apply security headers to all routes
        source: "/(.*)",
        headers: [
          {
            key:   "Content-Security-Policy",
            value: csp,
          },
          {
            // Prevent clickjacking
            key:   "X-Frame-Options",
            value: "DENY",
          },
          {
            // Prevent MIME-type sniffing
            key:   "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            // Control Referer header — important for the auth callback
            // fix: prevents the (now-consumed, but still present in URL)
            // PKCE ?code= from appearing in the Referer header sent to
            // any redirect destination. Set to strict-origin-when-cross-
            // origin so cross-origin navigations only send the origin,
            // not the full URL with query params.
            key:   "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            // Deny browser features not needed by SaveQuest
            key:   "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
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

module.exports = nextConfig;