// Render the accepted view of a .docx as plain text, paragraph by
// paragraph. Used by the agent prompt so the model sees the same
// view the matcher operates against — anchors it quotes from this
// rendering will resolve back to OOXML positions even if the model
// drifts on whitespace.

import JSZip from "jszip";
import { flattenParagraph } from "./flatten";
import {
  elChildren,
  elName,
  parseDocument,
  walkElements,
  type XNode,
} from "./xml";
import { getZipEntry } from "./zip";

const DOCUMENT_PATH = "word/document.xml";

export interface RenderedParagraph {
  /** Paragraph index in document order (0-based). */
  index: number;
  /** Plain-text content of the paragraph in accepted view. */
  text: string;
}

export interface RenderedDocument {
  paragraphs: RenderedParagraph[];
  /** Convenience join — paragraphs separated by a blank line. */
  asMarkdown: string;
}

/** Read a .docx and return its main body as a list of paragraph
 *  strings (accepted view). Headers/footers/comments/footnotes are
 *  intentionally skipped — only the main `word/document.xml` body. */
export async function renderAcceptedView(
  bytes: Buffer,
): Promise<RenderedDocument> {
  const zip = await JSZip.loadAsync(bytes);
  const entry = getZipEntry(zip, DOCUMENT_PATH);
  if (!entry) {
    throw new Error(
      `docx-redlines: missing ${DOCUMENT_PATH} in archive — not a valid .docx?`,
    );
  }
  const xml = await entry.async("string");
  const tree = parseDocument(xml);

  const paragraphs: RenderedParagraph[] = [];
  let index = 0;
  for (const node of walkElements(tree)) {
    if (elName(node) !== "w:p") continue;
    const flat = flattenParagraph(elChildren(node) as XNode[]);
    paragraphs.push({ index, text: flat.paraText });
    index++;
  }

  const asMarkdown = paragraphs
    .map((p) => p.text)
    .filter((t) => t.length > 0)
    .join("\n\n");
  return { paragraphs, asMarkdown };
}
