import { type LanguageModel, generateObject, streamObject } from "ai";
import {
  BLUE_SYSTEM_PROMPT,
  RED_SYSTEM_PROMPT,
  type ReviewContext,
  buildBlueUserPrompt,
  buildRedUserPrompt,
} from "./prompts";
import { type ReviewOutput, reviewSchema } from "./schema";

export interface RunReviewInput {
  side: "blue" | "red";
  model: LanguageModel;
  context: ReviewContext;
  /** AI-SDK telemetry hook id; helpful for tracing in observability. */
  telemetryFunctionId?: string;
  telemetryMetadata?: Record<string, string | number | boolean>;
}

export interface RunReviewResult {
  output: ReviewOutput;
  /** Reasoning trace if the provider returned one (Anthropic
   *  extended thinking, etc.). Empty string if the provider did not
   *  surface reasoning. */
  reasoning: string;
  /**
   * Token counts the provider reported. Reasoning + cached-input
   * tokens are tracked separately so cost estimation can apply the
   * right rate (reasoning bills at output rate; cached input bills
   * at a discount on Anthropic).
   */
  usage: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedInputTokens: number;
  };
}

/**
 * Run a single side's initial review. Pure: takes a model + context,
 * returns the structured output and any provider-side reasoning. The
 * caller decides how to persist (workflow, etc.).
 *
 * No retries here — workflow steps wrap the call with their own
 * durable retry semantics, so a flaky model call on this side just
 * throws.
 */
export async function runReview({
  side,
  model,
  context,
  telemetryFunctionId,
  telemetryMetadata,
}: RunReviewInput): Promise<RunReviewResult> {
  const system = side === "blue" ? BLUE_SYSTEM_PROMPT : RED_SYSTEM_PROMPT;
  const prompt =
    side === "blue"
      ? buildBlueUserPrompt(context)
      : buildRedUserPrompt(context);

  const result = await generateObject({
    model,
    schema: reviewSchema,
    system,
    prompt,
    experimental_telemetry: telemetryFunctionId
      ? {
          isEnabled: true,
          functionId: telemetryFunctionId,
          metadata: telemetryMetadata,
        }
      : undefined,
  });

  // AI SDK v6 returns reasoning on the result when the provider
  // produced any (e.g. Anthropic extended thinking). It can be a
  // string or undefined depending on the provider.
  const reasoning =
    typeof (result as { reasoning?: unknown }).reasoning === "string"
      ? ((result as { reasoning?: string }).reasoning ?? "")
      : "";

  return {
    output: result.object,
    reasoning,
    usage: {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      reasoningTokens: result.usage?.reasoningTokens ?? 0,
      cachedInputTokens: result.usage?.cachedInputTokens ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Streaming variant (phase 12)
// ---------------------------------------------------------------------------

export interface RunReviewStreamInput extends RunReviewInput {
  /**
   * Called as the model fills in the `summary` field of the partial
   * object. Receives the *delta* (the new text since the last call),
   * never the full accumulated string. Empty deltas are not emitted.
   * Awaited so the caller can backpressure (e.g., batch mutation
   * writes ~50ms and resolve once the batch flushes).
   */
  onSummaryDelta: (delta: string) => Promise<void> | void;
}

/**
 * Streaming variant of `runReview`. Same prompt, same schema — the
 * difference is `streamObject`'s `partialObjectStream`, which yields
 * progressively-more-complete partials. We diff each partial's
 * `summary` against the last seen one and emit just the delta to
 * `onSummaryDelta`. The structured `issues` array isn't streamed
 * (it lands at the end via `result.object`).
 *
 * Reasoning isn't surfaced here — `streamObject` doesn't expose
 * provider reasoning chunks the way `streamText` does, and we'd
 * rather have one LLM call than two for phase 12. Phase 13 may
 * revisit if extended-thinking streaming becomes a priority.
 */
export async function runReviewStream({
  side,
  model,
  context,
  telemetryFunctionId,
  telemetryMetadata,
  onSummaryDelta,
}: RunReviewStreamInput): Promise<RunReviewResult> {
  const system = side === "blue" ? BLUE_SYSTEM_PROMPT : RED_SYSTEM_PROMPT;
  const prompt =
    side === "blue"
      ? buildBlueUserPrompt(context)
      : buildRedUserPrompt(context);

  const result = streamObject({
    model,
    schema: reviewSchema,
    system,
    prompt,
    // Force Anthropic down its `jsonTool` structured-output path. The
    // default `auto` picks `outputFormat` for Haiku 4.5, which routes
    // through a beta endpoint that 404s. `jsonTool` uses a normal tool
    // call against the standard /v1/messages endpoint. No-op for
    // non-Anthropic providers — the SDK ignores unknown provider keys.
    providerOptions: {
      anthropic: { structuredOutputMode: "jsonTool" },
    },
    experimental_telemetry: telemetryFunctionId
      ? {
          isEnabled: true,
          functionId: telemetryFunctionId,
          metadata: telemetryMetadata,
        }
      : undefined,
  });

  let lastSummary = "";
  for await (const partial of result.partialObjectStream) {
    const summary =
      typeof (partial as { summary?: unknown }).summary === "string"
        ? ((partial as { summary?: string }).summary ?? "")
        : "";
    if (summary.length > lastSummary.length) {
      const delta = summary.slice(lastSummary.length);
      lastSummary = summary;
      if (delta.length > 0) await onSummaryDelta(delta);
    }
  }

  const object = await result.object;
  const usage = await result.usage;
  // streamObject in v6 doesn't surface reasoning the way generateObject
  // does; leave empty for now.
  return {
    output: object,
    reasoning: "",
    usage: {
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      reasoningTokens: usage?.reasoningTokens ?? 0,
      cachedInputTokens: usage?.cachedInputTokens ?? 0,
    },
  };
}
