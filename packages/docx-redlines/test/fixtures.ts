// Minimal .docx fixture builder for tests.
//
// A real .docx is a ZIP containing [Content_Types].xml + word/document.xml
// + a handful of rels files. We hand-roll the smallest viable set so
// tests don't depend on having a sample .docx checked into the repo,
// and so each test case can express its document body in a few lines.

import JSZip from "jszip";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_OPEN = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>`;

const DOC_CLOSE = `  </w:body>
</w:document>`;

/** Build a one-paragraph document where each entry in `runs` becomes
 *  a `<w:r><w:t xml:space="preserve">…</w:t></w:r>`. Use this to test
 *  cases where a `find` string spans run boundaries. */
export function paragraphFromRuns(runs: string[]): string {
  const inner = runs
    .map(
      (text) =>
        `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`,
    )
    .join("");
  return `<w:p>${inner}</w:p>`;
}

/** Build a docx from one or more paragraphs of raw OOXML. */
export async function buildDocx(paragraphsXml: string[]): Promise<Buffer> {
  const body = paragraphsXml.join("\n");
  const document = `${DOC_OPEN}\n${body}\n${DOC_CLOSE}`;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.folder("_rels")?.file(".rels", ROOT_RELS);
  zip.folder("word")?.file("document.xml", document);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** Pull `word/document.xml` back out of a .docx buffer as a string. */
export async function readDocumentXml(bytes: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file("word/document.xml");
  if (!entry) throw new Error("fixture: missing word/document.xml");
  return entry.async("string");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
