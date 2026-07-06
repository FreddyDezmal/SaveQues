/**
 * scripts/generate-build-info.js
 *
 * Sprint 16, Phase 5 — "Version information should be generated
 * automatically where possible. Avoid hardcoding values."
 *
 * Runs via the new `prebuild` script (see package.json) before every
 * `next build`, writing lib/buildInfo.generated.json fresh each time.
 * Nothing in this file is a value that needs to be remembered and bumped
 * by hand — version comes from package.json (single source of truth,
 * already used for npm/pnpm itself), commit SHA comes from Vercel's own
 * automatically-injected env vars (falls back to a local `git rev-parse`
 * for development, so `pnpm run build` produces a real value locally too,
 * not just on Vercel), and buildDate is captured at the moment this script
 * actually runs — which IS the real build time, unlike a value computed at
 * server-request time in a serverless function (which would reflect the
 * function's cold-start time, not the deploy's build time).
 *
 * The generated file is committed to .gitignore (see below) — it's build
 * output, not source, and regenerating it is what "automatic" means here.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const pkg = require("../package.json");

function getCommitSha() {
  // Vercel injects this automatically for every deployment — no
  // configuration needed on Vercel's side.
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  }
  // Local `pnpm run build` outside Vercel: fall back to git directly, so
  // the Version Info page shows something real in local dev too, not a
  // placeholder.
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "unknown";
  }
}

const buildInfo = {
  version: pkg.version,
  commitSha: getCommitSha(),
  buildDate: new Date().toISOString(),
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
};

const outPath = path.join(__dirname, "..", "lib", "buildInfo.generated.json");
fs.writeFileSync(outPath, JSON.stringify(buildInfo, null, 2));
console.log(`[generate-build-info] wrote ${outPath}:`, buildInfo);
