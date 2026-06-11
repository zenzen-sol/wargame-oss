import { type LanguageModel, hasToolCall, stepCountIs, streamText } from "ai";
import {
  BLUE_NEGOTIATION_PROMPT,
  type NegotiationContext,
  RED_NEGOTIATION_PROMPT,
  buildNegotiationUserPrompt,
} from "./negotiation-prompts";
import {
  type ProposalToolCall,
  negotiationTools,
  toProposalToolCall,
} from "./negotiation-tools";

export interface RunArgumentStreamInput {
  side: "blue" | "red";
  model: LanguageModel;
  context: NegotiationContext;
  /**
   * Called as the model emits each visible text delta. Receives the
   * delta since the last call. Awaited so callers can backpressure.
   */
  onTextDelta: (delta: string) => Promise<void> | void;
  /**
   * Called as the model emits each reasoning delta. Fires reliably
   * for OpenAI reasoning models when the call uses tools + multi-step
   * (which we always do here — see negotiation-tools.ts for why).
   * Stays silent on plain chat models.
   */
  onReasoningDelta: (delta: string) => Promise<void> | void;
  /**
   * Called once per turn when the model invokes one of the negotiation
   * tools (propose_clause_edit / accept_proposal / mark_impasse). With
   * parallelToolCalls=false and stopWhen on each tool, at most one
   * tool call fires per turn. If the model emits no tool call (the
   * implicit CONTINUE outcome), this never fires.
   */
  onToolCall?: (call: ProposalToolCall) => Promise<void> | void;
  telemetryFunctionId?: string;
  telemetryMetadata?: Record<string, string | number | boolean>;
}

export interface RunArgumentResult {
  /** Full visible text the agent produced. */
  text: string;
  /** Full reasoning trace (extended-thinking content). */
  reasoning: string;
  /**
   * Tool call this turn ended with, if any. Undefined means the
   * model chose to keep discussing (CONTINUE).
   */
  toolCall?: ProposalToolCall;
  /**
   * Token counts the provider reported. Workflow uses these to
   * accumulate per-run cost. Reasoning tokens (OpenAI o-series, gpt-5.x
   * thinking) are billed at the output rate — capturing them is
   * essential for accurate cost tracking; the trace had us under-
   * reporting by ~70% before this. Cached input tokens are billed at
   * a discount for Anthropic; we track them so the cost estimator
   * can apply the right rate.
   */
  usage: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedInputTokens: number;
  };
}

/**
 * Stream a single negotiation turn. The model writes argument prose,
 * then optionally calls one of three lock-in tools to end the turn:
 * propose_clause_edit, accept_proposal, or mark_impasse. A turn that
 * stops without any tool call is implicitly CONTINUE.
 *
 * Wrapped in a multi-step streamText (stopWhen on each tool) for two
 * reasons: (1) OpenAI's reasoning models reliably emit reasoning
 * summaries between steps in a tool loop, but go silent on
 * single-shot toolless calls; (2) structured proposals replace the
 * old PROPOSE «...» prose markers, so the UI can render a diff
 * artifact instead of forcing the user to watch boilerplate stream.
 */
export async function runArgumentStream({
  side,
  model,
  context,
  onTextDelta,
  onReasoningDelta,
  onToolCall,
  telemetryFunctionId,
  telemetryMetadata,
}: RunArgumentStreamInput): Promise<RunArgumentResult> {
  const system =
    side === "blue" ? BLUE_NEGOTIATION_PROMPT : RED_NEGOTIATION_PROMPT;
  const prompt = buildNegotiationUserPrompt(context, side);

  const result = streamText({
    model,
    system,
    prompt,
    tools: negotiationTools,
    // Stop the loop the moment the model picks any of the three
    // turn-ending tools. stepCountIs(3) is a hard ceiling so a
    // misbehaving model can't loop indefinitely calling tools we
    // don't have. With parallelToolCalls=false this is always one
    // tool call max anyway.
    stopWhen: [
      hasToolCall("propose_clause_edit"),
      hasToolCall("accept_proposal"),
      hasToolCall("mark_impasse"),
      stepCountIs(3),
    ],
    providerOptions: {
      // OpenAI reasoning models (o-series, gpt-5.x) need
      // `reasoningSummary: "detailed"` to emit reasoning summaries as
      // `reasoning-delta` events. The tool-loop above is the OTHER
      // half of the equation — without tools, mini emits nothing even
      // with these flags set.
      //
      // Two deliberate omissions vs augustus-omni's chat config:
      //   - `textVerbosity: "low"` is OFF. With it on, mini skipped
      //     the prose argument entirely and went straight to the
      //     tool call — empty conversation column, only the diff
      //     card. Default verbosity gives us the 4–10 sentences the
      //     prompt asks for.
      //   - `reasoningEffort` is "low" instead of "medium". On our
      //     long-context (full contract markdown + transcript)
      //     argument turns, "medium" produced 5+ minutes of
      //     reasoning per turn. "low" still emits useful summaries
      //     but caps runaway thinking.
      openai: {
        reasoningEffort: "low",
        reasoningSummary: "detailed",
        parallelToolCalls: false,
      },
      anthropic: {
        thinking: { type: "enabled", budgetTokens: 2000 },
      },
    },
    experimental_telemetry: telemetryFunctionId
      ? {
          isEnabled: true,
          functionId: telemetryFunctionId,
          metadata: telemetryMetadata,
        }
      : undefined,
  });

  let textBuffer = "";
  let reasoningBuffer = "";
  let toolCall: ProposalToolCall | undefined;
  // OpenAI reasoning summaries arrive as discrete sections — each
  // section is wrapped in (reasoning-start, [reasoning-delta...],
  // reasoning-end) parts. Without a separator between sections, the
  // delta text concatenates section-end directly into section-start
  // ("...general cap?Negotiating indemnity caps"). Track when we've
  // already emitted a section so the NEXT section starts with a
  // blank line.
  let hasEmittedReasoning = false;
  let pendingReasoningSeparator = false;

  for await (const part of result.fullStream) {
    if (part.type === "text-delta" && part.text.length > 0) {
      textBuffer += part.text;
      await onTextDelta(part.text);
    } else if (part.type === "reasoning-start") {
      if (hasEmittedReasoning) pendingReasoningSeparator = true;
    } else if (part.type === "reasoning-delta" && part.text.length > 0) {
      let delta = part.text;
      if (pendingReasoningSeparator) {
        delta = `\n\n${delta}`;
        pendingReasoningSeparator = false;
      }
      reasoningBuffer += delta;
      hasEmittedReasoning = true;
      await onReasoningDelta(delta);
    } else if (part.type === "tool-call") {
      const call = toProposalToolCall({
        toolName: part.toolName,
        input: part.input,
      });
      if (call) {
        toolCall = call;
        if (onToolCall) await onToolCall(call);
      }
    }
    // Other event types (reasoning-end, start, finish, error,
    // tool-result, etc.) intentionally ignored — they don't drive UI
    // state for the negotiation channel.
  }

  const usage = await result.usage;
  return {
    text: textBuffer,
    reasoning: reasoningBuffer,
    toolCall,
    usage: {
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      reasoningTokens: usage?.reasoningTokens ?? 0,
      cachedInputTokens: usage?.cachedInputTokens ?? 0,
    },
  };
}
