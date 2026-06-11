// Edge-runtime Sentry init for workflows. The workflows app
// currently runs everything on Node, but this file is loaded if any
// future route opts into the Edge runtime.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
  });
}
