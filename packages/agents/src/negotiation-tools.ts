// Tool definitions for negotiation-turn streamText calls.
//
// Three tools, each ends the turn:
//
//   propose_clause_edit — speaker puts concrete revised clause text on
//     the table. Replaces the prior PROPOSE «...» marker convention.
//   accept_proposal     — speaker accepts the OTHER side's most recent
//     proposal, quoting the agreed clause text verbatim. Replaces ACCEPT.
//   mark_impasse        — speaker declares incompatible positions.
//     Replaces IMPASSE.
//
// A turn that calls none of these is implicitly CONTINUE (still
// discussing, no language ready). The lock-in protocol is now
// schema-enforced rather than prose-marker-enforced — the resolution
// detector reads structured `toolCall` data from history, not regex.
//
// Why tools (and not just JSON output)?
// 1. Multi-step tool loops in OpenAI's Responses API reliably emit
//    reasoning summaries between steps. Single-shot toolless calls
//    on gpt-5.4-mini routinely emit nothing — confirmed against
//    augustus-omni's working setup.
// 2. The proposal becomes structured data we can render as a diff
//    artifact instead of forcing the user to watch ~400 chars of
//    repeated boilerplate stream every turn.

import { tool } from "ai";
import { z } from "zod";

/**
 * Discriminated union of the three turn-ending tool calls. Workflow
 * persists this on the message; UI renders the proposal ones as a
 * diff card.
 */
export type ProposalToolCall =
  | {
      name: "propose_clause_edit";
      clauseLanguage: string;
      rationale?: string;
    }
  | { name: "accept_proposal"; clauseLanguage: string }
  | { name: "mark_impasse"; reason: string };

export const NEGOTIATION_TOOL_NAMES = [
  "propose_clause_edit",
  "accept_proposal",
  "mark_impasse",
] as const;

export type NegotiationToolName = (typeof NEGOTIATION_TOOL_NAMES)[number];

/**
 * Zod-typed tool factories. `execute` returns the args verbatim so
 * the AI SDK has a tool result to record; we don't actually run any
 * side effect in-process — the workflow reads the tool call out of
 * the stream and persists it.
 */
export const negotiationTools = {
  propose_clause_edit: tool({
    description:
      "Put concrete revised clause language on the table. Use this when you are proposing new or refined draft text for the issue. The clauseLanguage must be the actual full clause as you would want it to appear in the contract — not a description of it. Use this OR accept_proposal OR mark_impasse to end your turn; otherwise the turn implicitly continues the discussion.",
    inputSchema: z.object({
      clauseLanguage: z
        .string()
        .min(1)
        .describe(
          "The exact revised clause text you are proposing. Full clause, ready to drop into the contract.",
        ),
      rationale: z
        .string()
        .optional()
        .describe(
          "Optional one-sentence note on what this proposal changes versus the prior draft.",
        ),
    }),
    execute: async (args) => args,
  }),
  accept_proposal: tool({
    description:
      "Accept the OTHER side's most recent propose_clause_edit. Quote the clause text VERBATIM from their proposal. If both sides accept the same text the issue is locked.",
    inputSchema: z.object({
      clauseLanguage: z
        .string()
        .min(1)
        .describe(
          "The exact clause text being accepted. Must match the other side's most recent proposal verbatim or near-verbatim.",
        ),
    }),
    execute: async (args) => args,
  }),
  mark_impasse: tool({
    description:
      "Declare impasse — positions are genuinely incompatible and no realistic trade will bridge them. Use sparingly. Do NOT call this just to end a turn cleanly.",
    inputSchema: z.object({
      reason: z
        .string()
        .min(1)
        .describe(
          "One sentence on why the gap can't be bridged — the substantive disagreement, not procedural.",
        ),
    }),
    execute: async (args) => args,
  }),
} as const;

/**
 * Convert an AI SDK tool-call event into our discriminated-union
 * shape. Returns undefined for tool names outside our negotiation
 * tool set (defensive — shouldn't happen if the model is configured
 * with only these tools).
 */
export function toProposalToolCall(args: {
  toolName: string;
  input: unknown;
}): ProposalToolCall | undefined {
  if (args.toolName === "propose_clause_edit") {
    const i = args.input as { clauseLanguage: string; rationale?: string };
    return {
      name: "propose_clause_edit",
      clauseLanguage: i.clauseLanguage,
      rationale: i.rationale,
    };
  }
  if (args.toolName === "accept_proposal") {
    const i = args.input as { clauseLanguage: string };
    return { name: "accept_proposal", clauseLanguage: i.clauseLanguage };
  }
  if (args.toolName === "mark_impasse") {
    const i = args.input as { reason: string };
    return { name: "mark_impasse", reason: i.reason };
  }
  return undefined;
}
