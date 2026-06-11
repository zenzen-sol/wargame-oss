/**
 * Format a byte count as a short human-readable string. KB/MB only —
 * `.docx` contracts shouldn't approach GB.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Postel's law: accept what we can. v1 supports .docx only. Some
 * browsers leave `file.type` empty for valid .docx, so we trust the
 * extension as a fallback.
 */
export function isAcceptableContractFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  if (!lower.endsWith(".docx")) return false;
  return file.type === DOCX_MIME || file.type === "";
}

export const DOCX_MIME_TYPE = DOCX_MIME;
export const DOCX_ACCEPT = ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
