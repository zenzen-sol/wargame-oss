import { z } from "zod";

export const issueSeverity = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);
export type IssueSeverity = z.infer<typeof issueSeverity>;

const issueSchema = z.object({
  title: z
    .string()
    .min(1)
    .max(200)
    .describe("Short headline for the issue (≤ 200 chars). No markdown."),
  summary: z
    .string()
    .min(1)
    .describe(
      "Full paragraph explaining what's at stake — the contract clause(s) involved, what could go wrong, what posture to take. Plain prose, 3–8 sentences. Cite section numbers and quote short clause excerpts when helpful.",
    ),
  severity: issueSeverity.describe(
    "low = nice-to-have polish; medium = worth pushing back on; high = significant negative consequence if accepted as-is; critical = deal-killer or material risk.",
  ),
});

export const reviewSchema = z.object({
  summary: z
    .string()
    .min(1)
    .describe(
      "1–2 short paragraphs summarising your overall read of the contract from your assigned perspective. State the headline takeaway in the first sentence.",
    ),
  issues: z
    .array(issueSchema)
    .describe(
      "All issues you'd flag from your perspective. Aim for completeness over brevity — every point that meaningfully shifts risk or value belongs here. 0 issues is acceptable only if the contract genuinely poses no concerns from your side.",
    ),
});

export type ReviewOutput = z.infer<typeof reviewSchema>;
export type ReviewIssue = z.infer<typeof issueSchema>;
