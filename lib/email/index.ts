/**
 * lib/email/index.ts
 * ─────────────────────────────────────────────────────────────
 * Sprint 27, Phase 9 — Email Provider Architecture.
 *
 * The one function business logic should ever call: sendEmail(message).
 * Everything about WHICH provider handles it — env var configuration,
 * which adapter class gets constructed, what happens when nothing's
 * configured — lives here and only here. lib/invites.ts (today) or any
 * future caller never imports a specific provider directly.
 *
 * Selection is env-var driven and OFF by default:
 *   EMAIL_PROVIDER        - "resend" | "sendgrid" | "postmark" | "mailgun" | "ses"
 *                            unset (the default) → nullEmailProvider, always.
 *   EMAIL_FROM_ADDRESS     - shared "from" address, required by every real adapter.
 *   RESEND_API_KEY
 *   SENDGRID_API_KEY
 *   POSTMARK_SERVER_TOKEN
 *   MAILGUN_API_KEY, MAILGUN_DOMAIN
 *   SES_ACCESS_KEY_ID, SES_SECRET_ACCESS_KEY, SES_REGION
 *
 * None of these are set anywhere in this project (checked .env.example
 * and every deployment config file during this phase's audit) — so in
 * this codebase, right now, getEmailProvider() always returns
 * nullEmailProvider. That's the "design the abstraction, do NOT
 * integrate a provider" instruction, enforced structurally: there is no
 * code path that reaches a real provider without someone deliberately
 * adding credentials that don't exist yet.
 */
import type { EmailProvider, EmailMessage, EmailSendResult } from "./types";
import { nullEmailProvider } from "./providers/null";
import { createResendProvider } from "./providers/resend";
import { createSendGridProvider } from "./providers/sendgrid";
import { createPostmarkProvider } from "./providers/postmark";
import { createMailgunProvider } from "./providers/mailgun";
import { createSesProvider } from "./providers/ses";

export type { EmailMessage, EmailSendResult, EmailProvider } from "./types";

/**
 * Pure selection logic — given an env-shaped object, decide which
 * provider to construct. Separated from `getEmailProvider()` (which
 * reads `process.env` directly) purely so it's unit-testable without
 * mutating global process.env in tests.
 */
export function selectEmailProvider(env: Record<string, string | undefined>): EmailProvider {
  const providerName = env.EMAIL_PROVIDER;
  const fromAddress = env.EMAIL_FROM_ADDRESS;

  if (!providerName) return nullEmailProvider;

  if (!fromAddress) {
    console.warn(`[email] EMAIL_PROVIDER=${providerName} set but EMAIL_FROM_ADDRESS is missing — falling back to no-op.`);
    return nullEmailProvider;
  }

  switch (providerName) {
    case "resend": {
      if (!env.RESEND_API_KEY) return warnMissing("resend", "RESEND_API_KEY");
      return createResendProvider({ apiKey: env.RESEND_API_KEY, fromAddress });
    }
    case "sendgrid": {
      if (!env.SENDGRID_API_KEY) return warnMissing("sendgrid", "SENDGRID_API_KEY");
      return createSendGridProvider({ apiKey: env.SENDGRID_API_KEY, fromAddress });
    }
    case "postmark": {
      if (!env.POSTMARK_SERVER_TOKEN) return warnMissing("postmark", "POSTMARK_SERVER_TOKEN");
      return createPostmarkProvider({ serverToken: env.POSTMARK_SERVER_TOKEN, fromAddress });
    }
    case "mailgun": {
      if (!env.MAILGUN_API_KEY || !env.MAILGUN_DOMAIN) return warnMissing("mailgun", "MAILGUN_API_KEY / MAILGUN_DOMAIN");
      return createMailgunProvider({ apiKey: env.MAILGUN_API_KEY, domain: env.MAILGUN_DOMAIN, fromAddress });
    }
    case "ses": {
      if (!env.SES_ACCESS_KEY_ID || !env.SES_SECRET_ACCESS_KEY || !env.SES_REGION) {
        return warnMissing("ses", "SES_ACCESS_KEY_ID / SES_SECRET_ACCESS_KEY / SES_REGION");
      }
      // Selecting this returns a provider whose send() always throws —
      // see providers/ses.ts's file header. Configuring credentials
      // doesn't change that; SES needs real implementation work first.
      return createSesProvider({
        accessKeyId: env.SES_ACCESS_KEY_ID,
        secretAccessKey: env.SES_SECRET_ACCESS_KEY,
        region: env.SES_REGION,
        fromAddress,
      });
    }
    default:
      console.warn(`[email] Unknown EMAIL_PROVIDER="${providerName}" — falling back to no-op.`);
      return nullEmailProvider;
  }
}

function warnMissing(provider: string, missingVars: string): EmailProvider {
  console.warn(`[email] EMAIL_PROVIDER=${provider} set but ${missingVars} is missing — falling back to no-op.`);
  return nullEmailProvider;
}

export function getEmailProvider(): EmailProvider {
  return selectEmailProvider(process.env as Record<string, string | undefined>);
}

/** The one function business logic should call. */
export async function sendEmail(message: EmailMessage): Promise<EmailSendResult> {
  return getEmailProvider().send(message);
}
