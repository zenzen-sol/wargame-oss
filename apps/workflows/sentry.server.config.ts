// Server-side Sentry init for the workflows app. Loaded by
// instrumentation.ts when NEXT_RUNTIME === "nodejs". Captures
// unhandled exceptions, rejected promises, and Sentry.captureException
// calls from API routes and workflow steps.
//
// Workflows has no UI surface — no client/edge configs needed.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
// Skip Sentry on local dev — VERCEL_ENV is only set on deploys.
// Keeps local noise out of Sentry's quota.
const onVercel = Boolean(process.env.VERCEL_ENV);

if (dsn && onVercel) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    // Default-deny on request bodies / headers. The start-conversion
    // and start-extraction routes accept the shared WORKFLOW_AUTH_TOKEN
    // in the POST body, and workflow steps handle BYOK plaintext keys
    // briefly in memory; either could otherwise leak via a thrown
    // error report.
    sendDefaultPii: false,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
  });
}
