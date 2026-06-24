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
  return [
    {
      source: "/(.*)",
      headers: [
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' https://app.posthog.com",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com",
            "img-src 'self' data: blob:",
            "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://app.posthog.com https://sentry.io https://*.sentry.io",
            "frame-src 'none'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "worker-src 'self' blob:",
          ].join("; "),
        },
        { key: "X-Frame-Options",       value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy",        value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy",     value: "camera=(), microphone=(), geolocation=()" },
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