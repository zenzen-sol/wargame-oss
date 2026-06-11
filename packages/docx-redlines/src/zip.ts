// JSZip path helpers.
//
// Some older Windows-authored .docx archives store entries with
// backslash separators (`word\document.xml`) instead of the canonical
// forward-slash form. JSZip looks up entries by exact string match, so
// `zip.file("word/document.xml")` misses those files. These helpers
// accept the forward-slash form and transparently fall back to the
// backslash variant so both reads and writes are robust.

import type JSZip from "jszip";

export function getZipEntry(
  zip: JSZip,
  pathSlash: string,
): JSZip.JSZipObject | null {
  const direct = zip.file(pathSlash);
  if (direct) return direct;
  const backslash = zip.file(pathSlash.replace(/\//g, "\\"));
  return backslash ?? null;
}

export function setZipEntry(
  zip: JSZip,
  pathSlash: string,
  content: string | Buffer,
): void {
  const backslash = pathSlash.replace(/\//g, "\\");
  // If the archive already stores the entry under backslashes, keep it
  // there so we don't emit both variants side by side.
  if (!zip.file(pathSlash) && zip.file(backslash)) {
    zip.file(backslash, content);
    return;
  }
  zip.file(pathSlash, content);
}
