// Public surface of @wargame-esq/docx-redlines.
//
// One entrypoint for v1: `applyTrackedEdits` takes a .docx and a batch
// of anchored find/replace edits and returns a new .docx with the
// substitutions written as native Word tracked changes. Headers,
// footers, comments, footnotes are intentionally untouched — only
// runs inside paragraphs of the main `word/document.xml` are
// considered.

export { applyTrackedEdits } from "./apply";
export { flattenDocument } from "./flatten-doc";
export type { FlattenedDocument } from "./flatten-doc";
export { renderAcceptedView } from "./render";
export type {
  RenderedDocument,
  RenderedParagraph,
} from "./render";
export type {
  AppliedChange,
  ApplyTrackedEditsOptions,
  ApplyTrackedEditsResult,
  EditError,
  EditInput,
} from "./types";
