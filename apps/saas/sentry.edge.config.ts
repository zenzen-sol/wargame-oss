// Edge-runtime Sentry init. Loaded by instrumentation.ts when
// NEXT_RUNTIME === "edge". Captures errors from Middleware and any
// Edge route handlers.
//
// The saas app uses Node runtime for the chat route + other heavy
// paths, so this is mostly a safety net for middleware / future
// edge routes.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
  });
}
