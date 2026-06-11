// Public types for the docx-redlines engine.
//
// `applyTrackedEdits` is the entrypoint. It takes a .docx file's bytes
// plus a list of find/replace edits, locates each edit's anchor, and
// returns a new .docx with the substitutions written as native Word
// tracked changes (`<w:ins>` / `<w:del>`).

export interface EditInput {
  /** Verbatim substring to replace. Empty string + a non-empty
   *  contextBefore/contextAfter pair makes the edit a pure insertion
   *  at that anchor. */
  find: string;
  /** Replacement text. Empty string makes the edit a pure deletion. */
  replace: string;
  /** ~40 characters preceding `find`, used to disambiguate matches.
   *  Need not be exact whitespace — the matcher normalises. */
  contextBefore: string;
  /** ~40 characters following `find`, used to disambiguate matches. */
  contextAfter: string;
  /** Short human note shown to the user on the diff card. */
  reason?: string;
}

export interface AppliedChange {
  /** Stable id we generate per change (independent of OOXML w:id). */
  id: string;
  /** OOXML `w:id` of the emitted `<w:del>` wrapper, when present. */
  delWId?: string;
  /** OOXML `w:id` of the emitted `<w:ins>` wrapper, when present. */
  insWId?: string;
  deletedText: string;
  insertedText: string;
  contextBefore: string;
  contextAfter: string;
  reason?: string;
}

export interface EditError {
  /** 0-based index into the input `edits[]` that failed. */
  index: number;
  reason: string;
}

export interface ApplyTrackedEditsResult {
  /** The new .docx file bytes. */
  bytes: Buffer;
  /** One entry per edit that landed. */
  changes: AppliedChange[];
  /** One entry per edit that couldn't be applied for substantive
   *  reasons (not-found, ambiguous, partial overlap with another
   *  edit). These represent real coverage loss — content the
   *  caller asked to change that the redline doesn't reflect. */
  errors: EditError[];
  /** One entry per edit that was a strict duplicate of another
   *  applied edit (fully contained within an earlier edit's range
   *  in the same paragraph). These do NOT represent coverage loss:
   *  the content was already changed by the earlier edit. Surface
   *  to the user separately from `errors` so a "10 emitted / 9
   *  applied / 1 redundant / 0 errored" report doesn't look like a
   *  failure. */
  redundant: EditError[];
}

export interface ApplyTrackedEditsOptions {
  /** Bytes of the source .docx. */
  bytes: Buffer;
  edits: EditInput[];
  /** Author label written into every `<w:ins>` / `<w:del>` w:author
   *  attribute. Use `"Blue"` / `"Red"` per the project convention. */
  author: string;
  /** ISO timestamp written into every `<w:ins>` / `<w:del>` w:date.
   *  Defaults to `new Date().toISOString()` if omitted. */
  date?: string;
}
