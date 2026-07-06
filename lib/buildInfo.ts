/**
 * lib/buildInfo.ts
 *
 * Reads the file scripts/generate-build-info.js writes on every `prebuild`.
 * That file is gitignored (it's build output), which means it won't exist:
 *   - in a fresh checkout before the first `pnpm run build`
 *   - in this delivered zip, since these instructions never ran an actual
 *     Next.js build in this environment
 * The try/catch fallback below is what makes that safe rather than a
 * crash — it falls back to package.json's version (always real, never
 * hardcoded here) with "unknown"/null for the values that genuinely can't
 * be known without a real build having run.
 */

import pkg from "../package.json";

export interface BuildInfo {
  version: string;
  commitSha: string;
  buildDate: string | null;
  environment: string;
}

export function getBuildInfo(): BuildInfo {
  try {
    // Dynamic require (not a static import) specifically because this file
    // may not exist — a static `import` of a possibly-missing file would
    // fail at compile time, not gracefully at runtime.
    const generated = require("./buildInfo.generated.json");
    return {
      version: generated.version ?? pkg.version,
      commitSha: generated.commitSha ?? "unknown",
      buildDate: generated.buildDate ?? null,
      environment: generated.environment ?? process.env.NODE_ENV ?? "development",
    };
  } catch {
    return {
      version: pkg.version,
      commitSha: "unknown",
      buildDate: null,
      environment: process.env.NODE_ENV ?? "development",
    };
  }
}
