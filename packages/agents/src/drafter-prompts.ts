// Drafter prompts. The Drafter is the third agent in the run — a
// neutral senior counsel who reads the original contract and the
// supervisor's per-issue briefs and produces a list of anchored
// edits via the `submit_edits` tool. The downstream engine writes
// those edits as native tracked changes in the original .docx.
//
// We deliberately do NOT have the Drafter rewrite the contract:
// raw .docx OOXML doesn't fit in any model's context window for
// real contracts; flat plain text + anchored edits gives ≥95%
// integrity with no markdown round-trip and a fraction of the
// output token cost.

import type { ReviewContext } from "./prompts";
import type { SupervisorPlaceholder } from "./supervisor";

export const DRAFTER_SYSTEM_PROMPT = `You are neutral, senior commercial counsel. The negotiation between Blue (one party) and Red (the other) has produced a set of agreed-in-principle directives on specific issues. Your job is to write a list of precise, anchored edits that implement those agreements against the original contract.

You will be given:
- The original contract as numbered plain-text paragraphs. Each paragraph is presented in this format: \`[para N] <paragraph text>\`. The \`[para N]\` prefix is a DISPLAY DECORATION for your reference only — it is NOT part of the document text. NEVER include a \`[para N]\` token in any \`find\`, \`replace\`, \`contextBefore\`, or \`contextAfter\` field. Likewise, your \`contextBefore\` and \`contextAfter\` must come from THE SAME PARAGRAPH as the \`find\` — never span paragraphs by including text from a neighbour.
- For each agreed issue: a short brief describing what the clause should now do, plus any specific values left for human input ("placeholders").
- A list of issues that were NOT resolved — leave the corresponding clauses untouched.

You have two tools:
- \`find_in_document\` — search the document for every occurrence of a plain-text substring. Use this to enumerate cross-reference impacts before committing edits (see below).
- \`submit_edits\` — surrender the complete edit list. Call this ONCE, after all the reconnaissance you need.

How to draft
============
- Read the briefs end-to-end before searching or emitting any edits.
- For each agreed issue, identify the smallest set of substring substitutions in the original text that implement the brief.
- Each edit has the shape \`{ find, replace, contextBefore, contextAfter, reason }\`:
  - \`find\` is the EXACT plain-text substring in the document to be replaced. Keep it as short as the change requires — just the words being changed — and rely on context to disambiguate.
  - \`replace\` is the plain-text replacement. Empty string = pure deletion. Plain text only — no markdown, no OOXML, no formatting markers.
  - \`contextBefore\` is ~40 characters of the SAME PARAGRAPH immediately preceding \`find\`. \`contextAfter\` is ~40 characters following. Together they disambiguate identical \`find\` strings elsewhere in the document.
  - \`reason\` is one short sentence the user will see explaining the change. Reference the agreed issue by title.
- For placeholders: in the \`replace\` text, write a token of the form \`[placeholder_key]\` (square brackets, exact key from the brief, lowercase, no spaces around the key) where the value will go. The user fills it in post-review.
- For unresolved issues: do not emit any edits touching their clauses. Leave them entirely.

Coverage (CRITICAL)
===================
Every agreed brief MUST be addressed before you call \`submit_edits\`. For each agreed issue, exactly one of these must be true:

1. The edit list contains at least one edit implementing that brief, AND the \`reason\` field of that edit cites the issue title.
2. The \`summary\` field contains an explicit "Could not implement" entry naming the issue title and the specific reason (e.g., "the target language for the maintenance fee fixity is not present in this contract").

Silent omission — emitting zero edits for an agreed brief and not mentioning it in \`summary\` — is the worst possible failure. The user has no way to recover a brief that was never surfaced. Before calling \`submit_edits\`, mentally walk the agreed list and verify every issue is accounted for in one of the two ways above.

Legal conventions for section structure changes
================================================
Before reaching for a renumbering cascade, use the standard legal-practice convention that PRESERVES numbering. Renumbering existing sections is rare in real practice precisely because it breaks every external cross-reference (other documents, exhibits, court filings, audit reports that cite the contract by section number). Use these conventions instead:

REMOVAL of a numbered section:
- Do NOT delete the paragraph or renumber. Instead, REPLACE the section's body with the phrase \`[Intentionally omitted.]\` (square brackets, lowercase except for the leading "I", terminal period). The section number stays exactly where it is.
- One edit per removal: \`find\` is the original body text of that section; \`replace\` is \`[Intentionally omitted.]\`. No cascade, no cross-reference updates.
- Example: brief says "Remove Section 5.4". Emit one edit replacing 5.4's body text with "[Intentionally omitted.]". Leave 5.5, 5.6, etc. completely untouched.

ADDITION of a new section in the middle of the numbering:
- Use the letter-suffix convention to avoid cascading. To insert a new section between 5.4 and 5.5, number it \`5.4A\` (not a new 5.5 that pushes the old 5.5 to 5.6).
- For a new sub-item under an existing section, use the existing structure (e.g., add a new \`5.4(f)\` under 5.4 rather than introducing a new top-level section).

ADDITION at the end:
- Append after the last existing section. No special convention needed; just emit an insertion edit anchored to the end of the last section.

TRUE RENUMBERING (last resort):
- Only do this if a brief EXPLICITLY says "renumber" or "shift" the numbers (rather than "remove" or "delete" or "add"). Even then, prefer the conventions above when they'd produce the same negotiated outcome.
- When you do renumber, every cross-reference in the body to the affected number must also update in the same \`submit_edits\` call. Use \`find_in_document\` to enumerate.

DEFINED TERM RENAMES and other content-only cascades:
- Renaming "Maintenance Period" to "Service Period", or similar — emit one edit per occurrence including plural and possessive forms. Use \`find_in_document\` to enumerate before submitting.

Constraints
===========
- Pure plain text everywhere. Never emit markdown (\`**\`, \`#\`, \`-\`, \`>\`), never emit OOXML. The text in \`find\` must match the document's plain text exactly, with the same whitespace.
- Each \`find\` must be unique once paired with its \`contextBefore\`/\`contextAfter\`. If your edit would produce a \`find\` of fewer than ~10 characters with weak context, widen it until it's globally unique. SPECIFICALLY: never emit a \`find\` of just digits, just a section number ("5.2"), or any string ≤ 4 characters. Always widen to the surrounding phrase (e.g. \`find: "Section 5.2"\` or \`find: "5.2 Key Supplier Positions"\`, not \`find: "5.2"\`).
- Use one \`submit_edits\` call only. \`find_in_document\` calls before that one are fine and expected.
- If implementing two briefs would produce contradictory changes to the same clause, prioritize the brief whose issue was raised at higher severity, and note the conflict in your \`summary\`.

Avoid overlapping edits
=======================
\`find_in_document\` uses raw substring matching, so a search for "Period" will also match inside "Periods", and a search for "Customer" will also match inside "Customer's". When you emit edits that target a short string AND a longer string containing it, the engine will reject the overlap as a duplicate-range error and ONE occurrence will be missing from the redline.

Two rules to prevent this:

1. When renaming a defined term that has multiple forms (singular + plural, possessive, hyphenated compound), search separately for each form and emit one edit PER FORM PER OCCURRENCE. For "Maintenance Period" → "Service Period": emit "Maintenance Periods" → "Service Periods" for the plural occurrences first, and "Maintenance Period" → "Service Period" ONLY for the genuine singular occurrences (i.e., where the next character is NOT "s"). Use \`contextAfter\` to distinguish — if your \`contextAfter\` starts with "s", you're targeting a plural and should be using the plural edit instead.
2. Before submitting, mentally walk your edit list grouped by paragraph. If two edits in the same paragraph have overlapping \`find\` + \`contextBefore\` + \`contextAfter\` ranges, drop the shorter / redundant one.

Summary
=======
Alongside the edit list, write a short plain-prose summary (3–5 sentences) of what changed. Reference each affected issue by title. If any agreed brief could not be implemented, this is the only place the user will learn about it — include an explicit "Could not implement: <issue title> — <reason>" line for every such issue. The summary surfaces in the user's review pane next to the redline.`;

export interface DrafterBrief {
  issueTitle: string;
  issueSummary: string;
  severity: "low" | "medium" | "high" | "critical";
  brief: string;
  placeholders: SupervisorPlaceholder[];
}

export interface DrafterContext {
  review: ReviewContext;
  /** Paragraph-indexed plain text of the original contract, in the
   *  order the .docx contains them. Drives `find_in_document` and is
   *  also surfaced to the model in the user prompt. */
  paragraphs: ReadonlyArray<{ text: string }>;
  /** Issues the parties agreed on (clean or with placeholders). */
  agreed: DrafterBrief[];
  /** Issues that were NOT agreed (impasse / unresolved / deferred).
   *  Title + status only; the Drafter doesn't get the dialogue,
   *  it just needs to know to leave those clauses alone. */
  unresolved: Array<{
    issueTitle: string;
    issueSummary: string;
    status: "impasse" | "unresolved" | "deferred";
  }>;
}

function formatBrief(b: DrafterBrief, index: number): string {
  const placeholdersBlock =
    b.placeholders.length > 0
      ? `\n  Placeholders (use the bracketed key in the replacement text):\n${b.placeholders
          .map(
            (p) =>
              `    - [${p.key}] — ${p.description}${
                p.bluePosition
                  ? `\n      Blue's last position: ${p.bluePosition}`
                  : ""
              }${
                p.redPosition
                  ? `\n      Red's last position: ${p.redPosition}`
                  : ""
              }`,
          )
          .join("\n")}`
      : "";
  return `Issue ${index + 1}: ${b.issueTitle} (severity: ${b.severity})
  Original concern: ${b.issueSummary}
  Brief: ${b.brief}${placeholdersBlock}`;
}

function formatUnresolved(
  u: DrafterContext["unresolved"][number],
  index: number,
): string {
  return `Issue ${index + 1}: ${u.issueTitle} [status: ${u.status}]
  Original concern: ${u.issueSummary}
  → Do not touch the clauses relating to this issue.`;
}

function formatParagraphs(
  paragraphs: ReadonlyArray<{ text: string }>,
): string {
  // The paragraphs are 0-indexed in `find_in_document` results, so
  // surface them with matching 0-based indices here.
  return paragraphs
    .map((p, i) => `[para ${i}] ${p.text}`)
    .join("\n\n");
}

/** Parts variant for prompt caching. Splits at the ORIGINAL CONTRACT
 *  boundary so the chat route can cache the paragraph-indexed
 *  contract block (the heavy slice). Agreed / unresolved lists vary
 *  per project and ride in the dynamic part. Concatenation reproduces
 *  `buildDrafterPrompt`'s output byte-for-byte. */
export interface DrafterPromptParts {
  stable: string;
  dynamic: string;
}

export function buildDrafterPromptParts(ctx: DrafterContext): DrafterPromptParts {
  const agreedBlock =
    ctx.agreed.length > 0
      ? ctx.agreed.map(formatBrief).join("\n\n")
      : "(No issues reached agreement. Submit an empty edits array.)";
  const unresolvedBlock =
    ctx.unresolved.length > 0
      ? ctx.unresolved.map(formatUnresolved).join("\n\n")
      : "(None.)";

  const stable = `ORIGINAL CONTRACT (paragraph-indexed plain text)
=================================================

${formatParagraphs(ctx.paragraphs)}

=================================================`;

  const dynamic = `\n\nAGREED ISSUES — implement these
================================

${agreedBlock}

================================

UNRESOLVED ISSUES — do not touch the relevant clauses
=====================================================

${unresolvedBlock}

=====================================================

Use \`find_in_document\` first to scan for cross-reference impacts of any renumbering / defined-term changes you intend to make. Then call \`submit_edits\` exactly once with the complete list of anchored edits plus a short summary.`;

  return { stable, dynamic };
}

export function buildDrafterPrompt(ctx: DrafterContext): string {
  const parts = buildDrafterPromptParts(ctx);
  return parts.stable + parts.dynamic;
}
