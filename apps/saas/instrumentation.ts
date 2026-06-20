// Server-side instrumentation. Wires two independent systems:
//   1. Langfuse — OpenTelemetry traces for LLM calls (review, argument,
//      drafter, memo). Lets us see token counts + cost per turn.
//   2. Sentry — error tracking for unhandled exceptions in server
//      actions, API routes, and the React render path (via
//      app/global-error.tsx for client crashes).
//
// We use NodeTracerProvider directly for Langfuse (not @vercel/otel)
// because @vercel/otel doesn't yet support OpenTelemetry JS SDK v2,
// which is what @langfuse/otel ships against. Sentry uses its own
// runtime-specific config files (sentry.server.config.ts /
// sentry.edge.config.ts) loaded conditionally below.

import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import * as Sentry from "@sentry/nextjs";

let activeLangfuseSpanProcessor: LangfuseSpanProcessor | null = null;

export async function flushLangfuse(): Promise<void> {
  await activeLangfuseSpanProcessor?.forceFlush();
}

export const langfuseSpanProcessor = {
  forceFlush: flushLangfuse,
};

export async function register() {
  // Langfuse: skip when keys aren't configured — keeps local dev
  // quiet for anyone who hasn't set up a Langfuse project yet.
  if (process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY) {
    activeLangfuseSpanProcessor = new LangfuseSpanProcessor();
    const tracerProvider = new NodeTracerProvider({
      spanProcessors: [activeLangfuseSpanProcessor],
    });
    tracerProvider.register();
  }

  // Sentry: load per-runtime config. Each file's init is a no-op if
  // NEXT_PUBLIC_SENTRY_DSN isn't set, so dev without Sentry stays
  // silent.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Wire Next's onRequestError signal to Sentry so request-time
// errors (route handlers, server actions, server components) reach
// the Sentry dashboard the same way client errors do.
export const onRequestError = Sentry.captureRequestError;
