// Server-side Sentry init. Loaded by instrumentation.ts when
// NEXT_RUNTIME === "nodejs". Captures unhandled exceptions, rejected
// promises, and any explicit Sentry.captureException(err) calls from
// server actions and route handlers.
//
// Coexists with the Langfuse OpenTelemetry provider in
// instrumentation.ts — different concerns (Sentry: errors;
// Langfuse: LLM call traces) so they don't conflict.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
// Skip Sentry entirely on local dev. VERCEL_ENV is defined automatically
// on Preview + Production deploys and undefined on `bun dev`, so this
// gate keeps local error noise out of the Sentry quota and event log
// without touching deployed signal.
const onVercel = Boolean(process.env.VERCEL_ENV);

if (dsn && onVercel) {
  Sentry.init({
    dsn,
    // 10% of normal traces; raise for noisy debugging windows.
    tracesSampleRate: 0.1,
    // Do NOT include request body, headers, or user data. We accept
    // BYOK plaintext keys on the wire (`saveApiKey` body), session
    // cookies on every request, OTPs on the sign-in path, and the
    // shared workflow auth token on trigger calls. Any throw on or
    // near those paths would otherwise ship the secret to Sentry's
    // event log, where it lives for months and is visible to anyone
    // with Sentry read access. Default-deny is the only safe stance.
    sendDefaultPii: false,
    // Don't fingerprint dev errors as prod — separate environments
    // so you can mute dev noise without losing prod signal.
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
  });
}
