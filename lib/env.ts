/**
 * lib/env.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralised environment variable validation for SaveQuest.
 *
 * DESIGN
 * • Call validateEnv() once at module load in next.config.js (server startup).
 * • Individual helpers (getEnv / getPublicEnv) are used throughout the app
 *   instead of bare process.env access, so missing vars surface at the point
 *   of use with a clear name — not as a cryptic downstream failure.
 * • Client-safe vars (NEXT_PUBLIC_*) are validated separately so the module
 *   can be imported from both server and client code.
 *
 * USAGE
 *   // In next.config.js (runs at build + server start):
 *   const { validateEnv } = require("./lib/env");
 *   validateEnv();
 *
 *   // In server code:
 *   import { getEnv } from "@/lib/env";
 *   const secret = getEnv("CRON_SECRET");
 *
 *   // In client code:
 *   import { getPublicEnv } from "@/lib/env";
 *   const url = getPublicEnv("NEXT_PUBLIC_SUPABASE_URL");
 */

// ── Types ─────────────────────────────────────────────────────────────────────

interface EnvSpec {
  key:      string;
  /** If true, missing var is a warning in dev but an error in production. */
  devOptional?: boolean;
  description: string;
}

// ── Required variable definitions ─────────────────────────────────────────────

/** Variables required on the server (never sent to the browser). */
const SERVER_VARS: EnvSpec[] = [
  {
    key:         "SUPABASE_SERVICE_ROLE_KEY",
    description: "Supabase service-role key for privileged server-side DB access",
  },
  {
    key:         "CRON_SECRET",
    description: "Secret used to authenticate requests to /api/cron/* endpoints",
  },
  {
    key:         "VAPID_PRIVATE_KEY",
    description: "VAPID private key for sending web push notifications (generate with scripts/generate-vapid-keys.mjs)",
  },
  {
    key:         "VAPID_SUBJECT",
    description: "VAPID subject — mailto: or https: URI identifying the push sender",
    devOptional: true,
  },
];

/** Variables that must exist on both server and client (NEXT_PUBLIC_ prefix). */
const PUBLIC_VARS: EnvSpec[] = [
  {
    key:         "NEXT_PUBLIC_SUPABASE_URL",
    description: "Supabase project URL (e.g. https://xyz.supabase.co)",
  },
  {
    key:         "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    description: "Supabase anon/public key for client-side queries",
  },
  {
    key:         "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
    description: "VAPID public key delivered to the browser for push subscription",
  },
];

/** Analytics vars — optional in dev, recommended in production. */
const ANALYTICS_VARS: EnvSpec[] = [
  {
    key:         "NEXT_PUBLIC_POSTHOG_KEY",
    description: "PostHog project API key (browser)",
    devOptional: true,
  },
  {
    key:         "POSTHOG_KEY",
    description: "PostHog project API key (server)",
    devOptional: true,
  },
];

// ── Core validation logic ──────────────────────────────────────────────────────

function checkVars(specs: EnvSpec[], env: Record<string, string | undefined>): string[] {
  const errors: string[] = [];
  const isProd = env.NODE_ENV === "production";

  for (const spec of specs) {
    const value = env[spec.key];
    const missing = !value || value.trim() === "" || value.includes("your_") || value.includes("your-");

    if (missing) {
      if (isProd || !spec.devOptional) {
        errors.push(`  ✗ ${spec.key} — ${spec.description}`);
      } else {
        // Dev-optional: just warn
        console.warn(`[env] ⚠  ${spec.key} is not set (optional in dev) — ${spec.description}`);
      }
    }
  }

  return errors;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Run full validation of all required environment variables.
 * Throws a descriptive error if any required var is missing.
 *
 * Call from next.config.js so failures surface at build/start time,
 * not at runtime when the first request hits a broken code path.
 */
export function validateEnv(): void {
  const env = process.env as Record<string, string | undefined>;
  const isProd = env.NODE_ENV === "production";

  const errors = [
    ...checkVars(PUBLIC_VARS,    env),
    ...checkVars(SERVER_VARS,    env),
    ...checkVars(ANALYTICS_VARS, env),
  ];

  if (errors.length > 0) {
    const lines = [
      "",
      "╔══════════════════════════════════════════════════════════════════╗",
      "║         SaveQuest — Missing Environment Variables                ║",
      "╠══════════════════════════════════════════════════════════════════╣",
      "║  The following required env vars are not set or contain          ║",
      "║  placeholder values. Copy .env.local.example → .env.local and   ║",
      "║  fill in real values before starting the server.                 ║",
      "╚══════════════════════════════════════════════════════════════════╝",
      "",
      ...errors,
      "",
      `  Reference: ${isProd ? "Set these in your Vercel / hosting environment variables." : "Copy .env.local.example → .env.local"}`,
      "",
    ];

    const message = lines.join("\n");

    if (isProd) {
      // Hard failure in production — do not start with missing config
      throw new Error(message);
    } else {
      // In dev: print a prominent warning but keep the server running
      // so developers can still work on unrelated parts of the app.
      console.error("\x1b[31m" + message + "\x1b[0m");
    }
  } else {
    if (env.NODE_ENV !== "test") {
      console.log("[env] ✓ All required environment variables are present.");
    }
  }
}

/**
 * Get a required server-side environment variable.
 * Throws immediately if the variable is not set, naming the missing key.
 * Use this instead of bare process.env access in server code.
 */
export function getEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `[env] Required environment variable "${key}" is not set. ` +
      `Check .env.local (dev) or your deployment environment variables (prod).`
    );
  }
  return value;
}

/**
 * Get a required NEXT_PUBLIC_ environment variable.
 * Safe to call from both server and client code.
 */
export function getPublicEnv(key: string): string {
  // In client bundles process.env is inlined at build time
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `[env] Required public environment variable "${key}" is not set. ` +
      `Ensure it is prefixed with NEXT_PUBLIC_ and present at build time.`
    );
  }
  return value;
}