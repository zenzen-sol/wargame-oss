// Document-level flattening.
//
// Walks the .docx's main `word/document.xml`, runs `flattenParagraph`
// on every `<w:p>` element, and returns a flat list of paragraph
// plain texts. Used by the drafter to:
//   - feed the model paragraph-segmented plain text as context, and
//   - power `find_in_document` lookups during anchored-edit
//     emission.
//
// We surface only the plain text. Per-run offset maps stay internal
// to `applyTrackedEdits` — callers that need to write tracked
// changes pass the edit list back through that entrypoint.

import JSZip from "jszip";
import { flattenParagraph } from "./flatten";
import { elChildren, elName, parseDocument, walkElements } from "./xml";

export interface FlattenedDocument {
  /** Paragraph plain texts in document order. Empty paragraphs are
   *  included so paragraph indices remain stable across reads. */
  paragraphs: Array<{ text: string }>;
}

export async function flattenDocument(
  bytes: Buffer | Uint8Array,
): Promise<FlattenedDocument> {
  const buf = bytes instanceof Buffer ? bytes : Buffer.from(bytes);
  const zip = await JSZip.loadAsync(buf);
  // Some Word builds store entries with backslash separators; mirror
  // the fallback used in zip.ts.
  const docEntry =
    zip.file("word/document.xml") ?? zip.file("word\\document.xml");
  if (!docEntry) {
    throw new Error("No word/document.xml in the supplied .docx");
  }
  const rawXml = await docEntry.async("string");
  const tree = parseDocument(rawXml);
  const paragraphs: Array<{ text: string }> = [];
  for (const el of walkElements(tree)) {
    if (elName(el) === "w:p") {
      const flat = flattenParagraph(elChildren(el));
      paragraphs.push({ text: flat.paraText });
    }
  }
  return { paragraphs };
}
