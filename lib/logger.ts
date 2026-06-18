/**
 * lib/logger.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Structured, levelled logging for SaveQuest server-side code.
 *
 * WHY
 *   Raw console.log produces unstructured output that's hard to query in
 *   production log aggregators (Vercel Log Drains, Datadog, Logtail, etc.).
 *   This module emits newline-delimited JSON in production and human-readable
 *   coloured output in development, with consistent fields across all logs.
 *
 * STANDARD FIELDS
 *   ts        — ISO 8601 timestamp
 *   level     — "info" | "warn" | "error" | "debug"
 *   service   — logical subsystem (e.g. "cron.notifications")
 *   message   — human-readable summary
 *   duration_ms — (optional) elapsed time for timed operations
 *   ...rest   — arbitrary context fields (user_id, goal_id, count, etc.)
 *
 * USAGE
 *   import { createLogger } from "@/lib/logger";
 *   const log = createLogger("cron.notifications");
 *
 *   log.info("Scheduler started", { run_id: "abc" });
 *   log.warn("Slow send", { user_id, duration_ms: 4200 });
 *   log.error("Push failed", { user_id, error: err.message });
 *   const end = log.time("send push batch");
 *   // ... work ...
 *   end({ sent: 12, failed: 0 });   // logs with duration_ms
 */

// ── Types ─────────────────────────────────────────────────────────────────────

type Level = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, string | number | boolean | null | undefined>;

interface LogEntry extends LogFields {
  ts:       string;
  level:    Level;
  service:  string;
  message:  string;
  duration_ms?: number;
}

// ── Dev formatting ─────────────────────────────────────────────────────────────

const DEV_COLORS: Record<Level, string> = {
  debug: "\x1b[36m", // cyan
  info:  "\x1b[32m", // green
  warn:  "\x1b[33m", // yellow
  error: "\x1b[31m", // red
};
const RESET = "\x1b[0m";

function formatDev(entry: LogEntry): string {
  const { ts, level, service, message, duration_ms, ...rest } = entry;
  const time    = ts.slice(11, 23); // HH:MM:SS.mmm
  const color   = DEV_COLORS[level];
  const dur     = duration_ms !== undefined ? ` (${duration_ms}ms)` : "";
  const extras  = Object.keys(rest).length
    ? " " + Object.entries(rest).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ")
    : "";
  return `${color}[${time}] [${level.toUpperCase()}] [${service}]${RESET} ${message}${dur}${extras}`;
}

// ── Emit ──────────────────────────────────────────────────────────────────────

function emit(entry: LogEntry): void {
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction) {
    // Structured JSON — parseable by log aggregators
    const consoleFn = entry.level === "error" ? console.error
                    : entry.level === "warn"  ? console.warn
                    : console.log;
    consoleFn(JSON.stringify(entry));
  } else {
    // Human-readable coloured output for local dev
    const consoleFn = entry.level === "error" ? console.error
                    : entry.level === "warn"  ? console.warn
                    : entry.level === "debug" ? console.debug
                    : console.log;
    consoleFn(formatDev(entry));
  }
}

// ── Logger factory ────────────────────────────────────────────────────────────

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info (message: string, fields?: LogFields): void;
  warn (message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /**
   * Start a timer. Returns a function that, when called, logs an info
   * message with duration_ms included. Pass extra fields to the closer.
   */
  time(operationName: string, startFields?: LogFields): (endFields?: LogFields) => void;
}

export function createLogger(service: string): Logger {
  function log(level: Level, message: string, fields?: LogFields): void {
    emit({
      ts:      new Date().toISOString(),
      level,
      service,
      message,
      ...fields,
    });
  }

  return {
    debug: (msg, fields) => log("debug", msg, fields),
    info:  (msg, fields) => log("info",  msg, fields),
    warn:  (msg, fields) => log("warn",  msg, fields),
    error: (msg, fields) => log("error", msg, fields),

    time(operationName: string, startFields?: LogFields) {
      const start = Date.now();
      log("info", `${operationName} started`, startFields);
      return (endFields?: LogFields) => {
        log("info", `${operationName} completed`, {
          ...endFields,
          duration_ms: Date.now() - start,
        });
      };
    },
  };
}