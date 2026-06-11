import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {};

// withWorkflow wires up Vercel's workflow runtime — `'use workflow'`
// directives won't be detected without it. withSentryConfig nests
// around the workflow-wrapped config so Sentry's source-map upload
// + onRequestError instrumentation work regardless of the runtime.
export default withSentryConfig(withWorkflow(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
});
