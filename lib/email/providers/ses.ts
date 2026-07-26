/**
 * lib/email/providers/ses.ts
 * Sprint 27, Phase 9.
 *
 * UNLIKE the other four adapters in this directory, this one is a
 * documented STUB, not a working implementation — and that's a
 * deliberate, reasoned scope decision, not laziness. Here's why:
 *
 * Resend, SendGrid, Postmark, and Mailgun all authenticate with a
 * simple Bearer token, server token, or HTTP Basic Auth header — one
 * static string, easy to build correctly and to verify against public
 * docs. Amazon SES's HTTP API requires AWS Signature Version 4: a
 * multi-step signing process (canonical request construction with
 * exact header trimming/lowercasing rules, canonical query string
 * sorting, a payload hash, a string-to-sign, and a signing key derived
 * through four rounds of HMAC-SHA256 keyed by date/region/service/
 * request-type). Every one of those steps has to be byte-exact or the
 * signature silently fails — AWS rejects the request, but the CODE
 * itself would look completely plausible while never actually working.
 *
 * That combination — high implementation complexity, easy-to-get-
 * subtly-wrong, and no way to test it against real AWS credentials in
 * this environment — is exactly the situation where writing confident-
 * looking code from memory would be worse than not writing it: it would
 * pass a code review by looking correct, then fail 100% of the time in
 * production. AWS's own documentation recommends using one of their
 * SDKs specifically because hand-rolled SigV4 is a well-known source of
 * exactly this kind of bug, even for experienced engineers with
 * production AWS access to test against.
 *
 * The honest, responsible move: implement the same EmailProvider
 * interface as every other adapter (so the abstraction layer doesn't
 * need to know or care that this one is different), document precisely
 * what real implementation would require, and fail loudly and
 * immediately if anyone tries to actually select this provider, rather
 * than silently pretending to sign requests it doesn't actually sign.
 *
 * TO IMPLEMENT FOR REAL: install `@aws-sdk/client-sesv2`, construct a
 * SESv2Client with the target region and credentials (or rely on the
 * ambient AWS credential chain, which Vercel/most hosts don't provide —
 * explicit access key + secret are more likely needed here), and call
 * `client.send(new SendEmailCommand({ FromEmailAddress, Destination:
 * { ToAddresses: [...] }, Content: { Simple: { Subject: { Data },
 * Body: { Text: { Data }, Html: { Data } } } } }))`. The SDK handles
 * SigV4 signing internally — this is the one adapter in this directory
 * where "use the vendor SDK" is the right call, not the "no new
 * dependency" principle the other four follow.
 */
import type { EmailProvider, EmailMessage, EmailSendResult } from "../types";

export function createSesProvider(_config: { accessKeyId: string; secretAccessKey: string; region: string; fromAddress: string }): EmailProvider {
  return {
    name: "ses",
    async send(_message: EmailMessage): Promise<EmailSendResult> {
      // Deliberately not implemented — see file header. Fails loudly
      // and immediately rather than attempting an unsigned or
      // incorrectly-signed request that would silently never work.
      throw new Error(
        "[email:ses] SES adapter is a documented stub, not implemented — AWS SigV4 signing requires the @aws-sdk/client-sesv2 package. See this file's header comment for exactly what's needed. Do not select EMAIL_PROVIDER=ses until this is implemented."
      );
    },
  };
}
