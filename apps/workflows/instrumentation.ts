// Server-side instrumentation for the workflows app. Wires two
// independent systems:
//   1. Langfuse — OpenTelemetry traces for the extraction LLM call
//      (and any future workflow-step LLM work). Lets us see token
//      counts + cost per workflow run.
//   2. Sentry — error tracking for unhandled exceptions in route
//      handlers (start-conversion, start-extraction) and workflow
//      steps.
//
// `flushLangfuse` is exported so workflow / step code can drain
// traces before the serverless container freezes — Vercel Workflows
// steps are separate invocations and the default batch processor
// won't drain on its own at step boundaries.
//
// We use NodeTracerProvider directly (not @vercel/otel) because
// @vercel/otel doesn't yet support OpenTelemetry JS SDK v2, which
// is what @langfuse/otel ships against. Per Langfuse's Vercel AI
// SDK integration guide.

import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import * as Sentry from "@sentry/nextjs";

let langfuseSpanProcessor: LangfuseSpanProcessor | null = null;

export async function flushLangfuse(): Promise<void> {
  await langfuseSpanProcessor?.forceFlush();
}

export async function register() {
  // Langfuse: skip when keys aren't configured.
  if (process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY) {
    langfuseSpanProcessor = new LangfuseSpanProcessor();
    const tracerProvider = new NodeTracerProvider({
      spanProcessors: [langfuseSpanProcessor],
    });
    tracerProvider.register();
  }

  // Sentry: load per-runtime config. Each file's init is a no-op
  // if NEXT_PUBLIC_SENTRY_DSN isn't set.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Wire Next's onRequestError signal to Sentry so request-time
// errors (route handlers, workflow steps) reach the dashboard.
export const onRequestError = Sentry.captureRequestError;
