// `submit_review` is the single-tool surface for review-phase turns:
// the agent writes a prose preface (streams as text) then surrenders
// the structured analysis (summary + issues) via this tool. The
// route's `streamReviewTurn` enforces stop-when on this tool name.

import { tool } from "ai";
import { reviewSchema } from "./schema";

export const reviewTools = {
  submit_review: tool({
    description:
      "Surrender your structured analysis. Call this once you have written your prose preface and identified the issues.",
    inputSchema: reviewSchema,
    execute: async (input) => input,
  }),
} as const;

export type ReviewToolName = keyof typeof reviewTools;
