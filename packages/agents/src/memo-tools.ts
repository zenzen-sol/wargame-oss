// Memo agent tool — single-tool surface for the memo phase.
// `streamText` is configured with `stopWhen: hasToolCall("submit_memo")`
// so the run completes when the agent surrenders the structured output.

import { tool } from "ai";
import { z } from "zod";

export const memoSeverity = z.enum(["low", "medium", "high", "critical"]);

const questionsField = z
  .array(z.string().min(1))
  .max(3)
  .default([])
  .describe(
    "Optional follow-up questions for the deal team. Each must be grounded in the recorded positions, gap, or agreed brief — do not freelance. Return an empty array when nothing concrete emerges.",
  );

export const memoAgreedSchema = z.object({
  issueTitle: z
    .string()
    .min(1)
    .describe("Title of the agreed issue (verbatim from the input)."),
  severity: memoSeverity.describe("Severity copied from the input."),
  raisedBy: z.enum(["blue", "red"]).describe("Which side raised the issue."),
  summary: z
    .string()
    .min(1)
    .describe(
      "One to two sentences describing what the parties agreed to. Paraphrase the agreed brief — do not quote it verbatim. If the deal team should confirm a numeric value, threshold, or factual assumption, note it briefly.",
    ),
  questions: questionsField,
});

export const memoOpenSchema = z.object({
  issueTitle: z
    .string()
    .min(1)
    .describe("Title of the open issue (verbatim from the input)."),
  severity: memoSeverity.describe("Severity copied from the input."),
  raisedBy: z.enum(["blue", "red"]).describe("Which side raised the issue."),
  gap: z
    .string()
    .min(1)
    .describe(
      "One to two sentences describing the substantive gap between the parties. Paraphrase the recorded gap; do not quote dialogue.",
    ),
  bluePosition: z
    .string()
    .min(1)
    .describe(
      "One sentence summarising Blue's last position. If Blue never committed to a specific stance, say so explicitly.",
    ),
  redPosition: z
    .string()
    .min(1)
    .describe(
      "One sentence summarising Red's last position. If Red never committed to a specific stance, say so explicitly.",
    ),
  recommendation: z
    .string()
    .min(1)
    .describe(
      "One to three sentences with a single clear next step for the deal team (escalate to principal, accept the counter-position with caveats, schedule a follow-up, etc.).",
    ),
  questions: questionsField,
});

export const memoNotYetDiscussedSchema = z.object({
  issueTitle: z
    .string()
    .min(1)
    .describe("Title of the not-yet-discussed issue (verbatim from the input)."),
  severity: memoSeverity.describe("Severity copied from the input."),
  raisedBy: z.enum(["blue", "red"]).describe("Which side raised the issue."),
  summary: z
    .string()
    .min(1)
    .describe(
      "One to two sentences re-stating the underlying concern. No recommendation — this issue has not been argued yet.",
    ),
  questions: questionsField,
});

export const submitMemoSchema = z.object({
  summary: z
    .string()
    .min(1)
    .describe(
      "Two to four sentences orienting the deal team. State the overall shape (counts of agreed / open / not-yet-discussed) and at most one dominant theme. Do NOT preview the issue list in prose.",
    ),
  agreed: z
    .array(memoAgreedSchema)
    .default([])
    .describe(
      "One entry per agreed change from the input. May be empty if the input had none.",
    ),
  openIssues: z
    .array(memoOpenSchema)
    .default([])
    .describe(
      "One entry per open issue from the input. May be empty if the input had none.",
    ),
  notYetDiscussed: z
    .array(memoNotYetDiscussedSchema)
    .default([])
    .describe(
      "One entry per not-yet-discussed issue from the input. May be empty if the input had none.",
    ),
});

export type MemoAgreedEntry = z.infer<typeof memoAgreedSchema>;
export type MemoOpenEntry = z.infer<typeof memoOpenSchema>;
export type MemoNotYetDiscussedEntry = z.infer<typeof memoNotYetDiscussedSchema>;
export type MemoDocument = z.infer<typeof submitMemoSchema>;

export const memoTools = {
  submit_memo: tool({
    description:
      "Surrender the memo as the final output of the memo phase. Call once after you've assembled the summary plus one entry per agreed, open, and not-yet-discussed issue.",
    inputSchema: submitMemoSchema,
    execute: async (input) => input,
  }),
} as const;

export type MemoToolName = keyof typeof memoTools;
