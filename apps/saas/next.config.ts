import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep OTel packages as Node externals — Turbopack chokes on their
  // dynamic `require()` calls at bundle time, which silently kills
  // the instrumentation hook so spans never reach Langfuse. The
  // workflows app needs the same externals for the same reason.
  serverExternalPackages: [
    "@langfuse/otel",
    "@langfuse/tracing",
    "@opentelemetry/api",
    "@opentelemetry/sdk-trace-node",
  ],
};

// Sentry wrapper. Reads SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN
// from env at build time so source maps are uploaded for readable
// stack traces. All three must be set on Vercel (Production + Preview)
// for source map upload to succeed; missing them only suppresses the
// upload, not the runtime SDK.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
});
