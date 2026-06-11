// Client-side Sentry init. Next.js auto-loads this file for the
// browser bundle. Captures uncaught browser errors, unhandled
// promise rejections, and any explicit Sentry.captureException
// calls from React components.
//
// The exported `onRouterTransitionStart` lets Sentry instrument
// App Router navigations as transactions — useful for "this page
// loaded slow" trails.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
// Skip Sentry on local dev. Use NEXT_PUBLIC_VERCEL_ENV (not VERCEL_ENV)
// because only the NEXT_PUBLIC_ prefix gets inlined into the browser
// bundle. Vercel sets it automatically on deploys; undefined locally.
const onVercel = Boolean(process.env.NEXT_PUBLIC_VERCEL_ENV);

if (dsn && onVercel) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    // No replay by default — meaningful PII risk + Sentry quota
    // burn. Add intentionally if/when you want it.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    // Default-deny on request bodies / headers / user data. Browser
    // forms that POST plaintext API keys, OTPs, or session cookies
    // would otherwise leak to Sentry on any thrown error. See the
    // matching note in sentry.server.config.ts.
    sendDefaultPii: false,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
