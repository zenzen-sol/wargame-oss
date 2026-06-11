// Apply a list of anchored edits to the project's source .docx and
// persist the resulting tracked-change file to Storage.
//
// The drafter emits `EditInput[]` directly via the `submit_edits`
// tool, so this function no longer does any diffing — it loads the
// original bytes, hands them to `applyTrackedEdits`, and uploads
// the result. Anchored edits replaced the retired markdown-diff
// intermediate step, which round-tripped lossily through markdown.

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { downloadObject, uploadObject } from "@/lib/storage";
import {
  type EditInput,
  applyTrackedEdits,
  flattenDocument,
} from "@wargame-esq/docx-redlines";

export interface OriginalDocx {
  /** Bytes of the project's source .docx. */
  bytes: Buffer;
  /** Display filename of the source .docx (without redline suffix). */
  filename: string;
  /** Paragraph plain texts in document order. */
  paragraphs: Array<{ text: string }>;
}

/** Load the project's first .docx, return both raw bytes (for the
 *  redline writer) and the flattened paragraph store (for the
 *  drafter's input + `find_in_document`). */
export async function loadOriginalDocx(
  projectId: string,
): Promise<OriginalDocx> {
  const admin = createAdminClient();
  const { data: files = [], error: filesErr } = await admin
    .from("files")
    .select("id, name, storage_key")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (filesErr) throw filesErr;
  const source = (files ?? []).find(
    (f) => f.storage_key && (f.name ?? "").toLowerCase().endsWith(".docx"),
  );
  if (!source || !source.storage_key) {
    throw new Error("No source .docx found for project.");
  }
  const bytes = Buffer.from(await downloadObject(source.storage_key));
  const { paragraphs } = await flattenDocument(bytes);
  return {
    bytes,
    filename: source.name ?? "contract.docx",
    paragraphs,
  };
}

export interface RedlineCompileInput {
  projectId: string;
  ownerId: string;
  /** Original .docx bytes. Pass through from `loadOriginalDocx`. */
  originalBytes: Buffer;
  /** Source filename — used to derive the download filename. */
  originalFilename: string;
  /** Anchored edits to apply, from the drafter's `submit_edits` tool. */
  edits: EditInput[];
}

export interface RedlineCompileResult {
  storageKey: string;
  downloadFilename: string;
  /** Number of edits that landed cleanly. */
  changesApplied: number;
  /** Number of edits the engine couldn't anchor (ambiguous, not-found,
   *  etc.). Surfaced to the user; not silently dropped. */
  changesErrored: number;
}

export async function compileRedline(
  input: RedlineCompileInput,
): Promise<RedlineCompileResult> {
  const { projectId, ownerId, originalBytes, originalFilename, edits } = input;

  const applied = await applyTrackedEdits({
    bytes: originalBytes,
    edits,
    author: "Counsel",
    date: new Date().toISOString(),
  });

  // Surface per-edit failure reasons. Without this we only see the
  // count in the route log and have no way to know whether the
  // drafter emitted an unmatchable `find`, a paragraph mis-anchor,
  // an overlap, or something else.
  if (applied.errors.length > 0) {
    console.warn(
      `[redline-compile] ${applied.errors.length} edits did not apply for project=${projectId.slice(0, 8)}:`,
      JSON.stringify(applied.errors.slice(0, 5), null, 2),
    );
  }

  const baseName = originalFilename.replace(/\.docx$/i, "");
  const downloadFilename = `${baseName}.redline.docx`;
  const storageKey = `${ownerId}/${projectId}/redline-${crypto.randomUUID()}.docx`;
  await uploadObject(
    storageKey,
    new Uint8Array(applied.bytes),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );

  return {
    storageKey,
    downloadFilename,
    changesApplied: applied.changes.length,
    changesErrored: applied.errors.length,
  };
}
