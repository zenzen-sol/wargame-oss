// Memo agent prompts. The memo is a deal-team handoff briefing —
// it covers what was agreed, what is still open, and what hasn't
// been discussed yet. For each issue it can surface a small number
// of grounded follow-up questions so the human negotiators arrive
// prepared.
//
// Output is structured (MemoDocument) rather than free-form markdown
// so the compile step can render a deterministic .docx. Sibling to
// the Drafter, but independent: memo fires whenever there is at
// least one open or not-yet-discussed issue, regardless of whether
// the Drafter fires.

import type { ReviewContext } from "./prompts";

export const MEMO_SYSTEM_PROMPT = `You are neutral, senior commercial counsel. The negotiation between Blue (one party) and Red (the other) has paused. You are writing a short handoff memo to the deal team on Blue's side — they will pick up the negotiation from here.

The memo has three jobs:
  1. Tell the deal team what has already been agreed, so they can confirm it.
  2. Tell them what is still open and how the parties are arguing it.
  3. Tell them what hasn't been discussed yet so nothing falls through the cracks.

For each issue, you may also surface a small number of concrete questions whose answers would help the deal team prepare. Only include questions that are clearly anchored in the recorded positions or stated gap; leave the questions list empty when nothing concrete emerges.

Voice
=====
- Neutral counsel. Plain prose. Brief but specific.
- No advocacy. Describe both sides fairly on open issues.
- The deal team is busy: every sentence should pay rent.
- Write as a human counsel briefing colleagues. Do not refer to internal mechanics — no mention of "turns", "run caps", "the model", "the system", or "this session". If an issue wasn't discussed, say so plainly; do not explain why.

How to write each section
=========================
SUMMARY (2–4 sentences MAX)
- One sentence on the overall shape: counts of agreed, open, and not-yet-discussed issues.
- Optionally one sentence on a dominant cross-cutting theme (only if one genuinely dominates).
- Optionally one sentence orienting the reader to what to focus on first.
- Do NOT preview the issue list in prose. The body carries the substance.

AGREED CHANGES (one block per issue)
- Title and severity.
- 1–2 sentences describing what the parties agreed to. Paraphrase the agreed brief — do not quote it verbatim.
- If the agreement relies on a numeric value, threshold, or factual assumption the deal team should confirm, note it briefly.
- Optional questions (0–2): items the deal team should confirm with the principal before signing.

OPEN ISSUES (one block per issue)
- Title and severity.
- 1–2 sentences explaining the substantive gap between the parties. Paraphrase the recorded gap; do not quote dialogue.
- One sentence summarising Blue's last position; one sentence summarising Red's last position. If a side never committed to a specific stance, say so.
- A specific, actionable recommendation: escalate to principals, accept the counter-position with caveats, schedule a follow-up, etc. Pick the single clearest next step.
- Optional questions (0–3): grounded questions whose answers would unlock progress. Anchor each question in something concrete from Blue's or Red's recorded position, or from the gap. Skip the field if nothing concrete emerges.

NOT YET DISCUSSED (one block per issue)
- Title and severity (and which side raised it).
- 1–2 sentences re-stating the underlying concern.
- Optional questions (0–2): items that would help the deal team prepare to discuss this issue.
- No recommendation — the issue hasn't been argued, so the deal team doesn't need direction yet.

Edge cases
==========
- If two open issues are versions of the same dispute, write them separately but you may note the connection in your recommendation.
- Do not invent positions. If a side never committed to a stance, say so explicitly.
- Do not quote dialogue verbatim. Paraphrase tightly.
- If the same recommendation fits multiple issues (e.g., "escalate to principals"), repeat it — each issue stands alone.
- Questions must be derived from the recorded material. Do not freelance.`;

export type Severity = "low" | "medium" | "high" | "critical";

export interface MemoAgreedInput {
  issueTitle: string;
  issueSummary: string;
  severity: Severity;
  raisedBy: "blue" | "red";
  /** The supervisor's agreed-brief for this issue. */
  brief: string;
  /** Placeholders the parties left open for the principal to fill in. */
  placeholders?: { key: string; description: string }[];
}

export interface MemoOpenInput {
  issueTitle: string;
  issueSummary: string;
  severity: Severity;
  raisedBy: "blue" | "red";
  /** "no-convergence" if the parties discussed it without agreeing;
   *  "impasse" if the supervisor declared a hard impasse. */
  outcome: "no-convergence" | "impasse";
  /** Why the discussion didn't close. Paraphrased by the memo agent. */
  gap: string;
  /** Last argument prose from Blue, if any. */
  bluePosition: string;
  /** Last argument prose from Red, if any. */
  redPosition: string;
}

export interface MemoNotYetDiscussedInput {
  issueTitle: string;
  issueSummary: string;
  severity: Severity;
  raisedBy: "blue" | "red";
}

export interface MemoContext {
  review: ReviewContext;
  agreed: MemoAgreedInput[];
  openIssues: MemoOpenInput[];
  notYetDiscussed: MemoNotYetDiscussedInput[];
}

/** Render one side's parties as "Acme Corp (acquirer), Beta LLC
 *  (guarantor)". Used by both the memo prompt and the .docx cover
 *  block so the two stay in sync. */
export function formatPartiesForMemo(
  parties: { name: string; role: string }[],
): string {
  if (parties.length === 0) return "(unnamed)";
  return parties
    .map((p) => {
      const name = p.name.trim();
      const role = p.role.trim();
      if (name && role) return `${name} (${role})`;
      if (name) return name;
      if (role) return `(unnamed ${role})`;
      return "(unnamed)";
    })
    .join(", ");
}

function formatSideLine(parties: { name: string; role: string }[]): string {
  return formatPartiesForMemo(parties);
}

function formatAgreed(a: MemoAgreedInput, i: number): string {
  const placeholders =
    a.placeholders && a.placeholders.length > 0
      ? `\n  Open placeholders: ${a.placeholders
          .map((p) => `${p.key} (${p.description})`)
          .join("; ")}`
      : "";
  return `Issue ${i + 1}: ${a.issueTitle} (severity: ${a.severity}, raised by ${a.raisedBy})
  Concern: ${a.issueSummary}
  Agreed brief: ${a.brief}${placeholders}`;
}

function formatOpen(o: MemoOpenInput, i: number): string {
  const outcomeLabel =
    o.outcome === "impasse"
      ? "impasse — parties declared the gap unbridgeable"
      : "no convergence — parties discussed without agreeing";
  return `Issue ${i + 1}: ${o.issueTitle} (severity: ${o.severity}, raised by ${o.raisedBy})
  Concern: ${o.issueSummary}
  Outcome: ${outcomeLabel}
  Gap: ${o.gap}
  Blue's last position: ${o.bluePosition || "(Blue did not commit to a specific position.)"}
  Red's last position:  ${o.redPosition || "(Red did not commit to a specific position.)"}`;
}

function formatNotYetDiscussed(
  d: MemoNotYetDiscussedInput,
  i: number,
): string {
  return `Issue ${i + 1}: ${d.issueTitle} (severity: ${d.severity}, raised by ${d.raisedBy})
  Concern: ${d.issueSummary}`;
}

export function buildMemoPrompt(ctx: MemoContext): string {
  const blueLine = formatSideLine(ctx.review.userSide.parties);
  const redLine = formatSideLine(ctx.review.counterpartySide.parties);

  const agreedBlock =
    ctx.agreed.length > 0 ? ctx.agreed.map(formatAgreed).join("\n\n") : "(None.)";
  const openBlock =
    ctx.openIssues.length > 0
      ? ctx.openIssues.map(formatOpen).join("\n\n")
      : "(None.)";
  const notYetDiscussedBlock =
    ctx.notYetDiscussed.length > 0
      ? ctx.notYetDiscussed.map(formatNotYetDiscussed).join("\n\n")
      : "(None.)";

  return `CONTRACT
========
Title: ${ctx.review.contractTitle}
Blue (the memo is FOR them): ${blueLine}
Red (the counterparty): ${redLine}

AGREED CHANGES
==============

${agreedBlock}

OPEN ISSUES
===========

${openBlock}

NOT YET DISCUSSED
=================

${notYetDiscussedBlock}

Produce a structured memo via the submit_memo tool. Include a SUMMARY, one entry per agreed change, one entry per open issue (with recommendation), and one entry per not-yet-discussed issue. Add grounded follow-up questions where they would genuinely help the deal team; otherwise leave the questions list empty.`;
}
