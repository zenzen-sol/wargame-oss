// Drafter tools — the drafting phase emits a list of anchored edits
// rather than a full revised contract. The engine in
// `@wargame-esq/docx-redlines` consumes the same `EditInput[]` shape
// natively, so no diff step is required.
//
// Two tools:
//   - `find_in_document`: pre-emission reconnaissance. Lets the
//     drafter scan the paragraph store for cross-reference impacts
//     before committing edits that renumber clauses or change
//     defined terms.
//   - `submit_edits`:    final surrender. Called once after the
//     reconnaissance is done; `streamText` is configured to stop
//     here.
//
// `drafterTools` is the STATIC version used for UI type inference
// via `InferUITools`. The route's runtime builds the tools with
// `createDrafterTools(paragraphs)` so `find_in_document`'s execute
// can close over the loaded paragraph store.

import { tool } from "ai";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const editInputSchema = z.object({
  find: z
    .string()
    .describe(
      "Exact substring in the document to replace. Empty string + a non-empty contextBefore/contextAfter pair = pure insertion at that anchor.",
    ),
  replace: z
    .string()
    .describe(
      "Replacement text. Empty string = pure deletion. Plain text — never markdown, never OOXML.",
    ),
  contextBefore: z
    .string()
    .describe(
      "~40 characters immediately preceding `find` in the source paragraph, used to disambiguate identical finds. Keep it from the same paragraph as `find`.",
    ),
  contextAfter: z
    .string()
    .describe(
      "~40 characters immediately following `find` in the source paragraph, used to disambiguate identical finds.",
    ),
  reason: z
    .string()
    .min(1)
    .describe(
      "One short sentence explaining why this edit is being made. Shown to the user on a per-edit basis.",
    ),
});

export const submitEditsSchema = z.object({
  edits: z
    .array(editInputSchema)
    .describe(
      "The complete list of substring substitutions that, applied together, implement every agreed brief. Order doesn't matter — the engine resolves anchors independently. Cascading impacts (renumbering, cross-references, defined-term changes) MUST be included as separate edits in the same call.",
    ),
  summary: z
    .string()
    .min(1)
    .describe(
      "Plain-prose summary of what was changed and why. 3–5 sentences. References affected issues by title. Surfaces in the run UI alongside the redline affordance.",
    ),
});

export type SubmitEdits = z.infer<typeof submitEditsSchema>;
export type DrafterEdit = z.infer<typeof editInputSchema>;

export const findInDocumentSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "Substring to search for in the document, plain text. Case-sensitive. Use to scan for cross-reference cascades before submitting edits.",
    ),
  maxMatches: z
    .number()
    .int()
    .min(1)
    .max(50)
    .nullable()
    .describe(
      "Optional cap on returned matches. Default 10. Set higher when enumerating cross-references; set lower for spot checks.",
    ),
});

export type FindInDocument = z.infer<typeof findInDocumentSchema>;

export interface FindInDocumentMatch {
  /** 0-based paragraph index in the order paragraphs were supplied. */
  paragraphIndex: number;
  /** Up to 60 chars of paragraph text preceding the match. */
  before: string;
  /** The matched substring (equal to the query). */
  match: string;
  /** Up to 60 chars of paragraph text following the match. */
  after: string;
}

export interface FindInDocumentResult {
  matches: FindInDocumentMatch[];
  /** True when more matches existed than were returned. */
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Runtime search
// ---------------------------------------------------------------------------

const FIND_CONTEXT_CHARS = 60;
const FIND_DEFAULT_MAX = 10;

/** Pure function: scan a paragraph store for occurrences of `query`.
 *  No streaming, no I/O — the route owns the paragraph store and
 *  hands it to the tool via the factory. */
export function findInDocument(
  paragraphs: ReadonlyArray<{ text: string }>,
  input: FindInDocument,
): FindInDocumentResult {
  const max = input.maxMatches ?? FIND_DEFAULT_MAX;
  const matches: FindInDocumentMatch[] = [];
  let truncated = false;
  outer: for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    if (!para) continue;
    let from = 0;
    while (true) {
      const at = para.text.indexOf(input.query, from);
      if (at === -1) break;
      if (matches.length >= max) {
        truncated = true;
        break outer;
      }
      matches.push({
        paragraphIndex: i,
        before: para.text.slice(
          Math.max(0, at - FIND_CONTEXT_CHARS),
          at,
        ),
        match: para.text.slice(at, at + input.query.length),
        after: para.text.slice(
          at + input.query.length,
          at + input.query.length + FIND_CONTEXT_CHARS,
        ),
      });
      from = at + Math.max(1, input.query.length);
    }
  }
  return { matches, truncated };
}

// ---------------------------------------------------------------------------
// Tools — static (for UI type inference) and factory (for runtime)
// ---------------------------------------------------------------------------

const FIND_TOOL_DESCRIPTION =
  "Search the document for every occurrence of a plain-text substring. Returns paragraph indices with ~60 chars of surrounding context. Use this BEFORE submitting edits to enumerate cross-reference impacts when you're about to renumber a clause, change a defined term, or shift a schedule reference. The tool result is fed back into your context so subsequent reasoning sees the hits.";

const SUBMIT_TOOL_DESCRIPTION =
  "Surrender the complete list of anchored edits. Call ONCE, after any `find_in_document` reconnaissance you needed to do. Each edit is a precise substring substitution, NOT a whole-paragraph or whole-clause replacement. Keep `find` short (just the words being changed); rely on `contextBefore`/`contextAfter` to disambiguate identical finds. Any edit that shifts clause numbering or changes a defined term must be accompanied by edits to every cross-reference in the same call.";

/** Static toolset — used by `wargame-tools.ts` for UI type inference
 *  via `InferUITools`. The find_in_document execute returns an empty
 *  result; the runtime uses `createDrafterTools` instead. */
export const drafterTools = {
  find_in_document: tool({
    description: FIND_TOOL_DESCRIPTION,
    inputSchema: findInDocumentSchema,
    execute: async (): Promise<FindInDocumentResult> => ({
      matches: [],
      truncated: false,
    }),
  }),
  submit_edits: tool({
    description: SUBMIT_TOOL_DESCRIPTION,
    inputSchema: submitEditsSchema,
    execute: async (input) => input,
  }),
} as const;

export type DrafterToolName = keyof typeof drafterTools;

/** Factory: build a tools object whose `find_in_document` execute
 *  closes over the route's loaded paragraph store. Use this at the
 *  route level for `streamText({ tools: createDrafterTools(...) })`. */
export function createDrafterTools(args: {
  paragraphs: ReadonlyArray<{ text: string }>;
}) {
  return {
    find_in_document: tool({
      description: FIND_TOOL_DESCRIPTION,
      inputSchema: findInDocumentSchema,
      execute: async (input): Promise<FindInDocumentResult> =>
        findInDocument(args.paragraphs, input),
    }),
    submit_edits: tool({
      description: SUBMIT_TOOL_DESCRIPTION,
      inputSchema: submitEditsSchema,
      execute: async (input) => input,
    }),
  } as const;
}
