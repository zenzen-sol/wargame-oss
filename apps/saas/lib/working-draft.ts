// Document-version bookkeeping for the `project_document_versions`
// table. The current pipeline records one `source='upload'` row per
// file and compiles the redline once at run completion (see
// lib/redline-compile.ts); the per-turn proposal/accepted writers that
// once lived here were retired with the anchored-edit protocol.

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Tables } from "@/types/database.types";

export type VersionRow = Tables<"project_document_versions">;

/** Record the project's original upload as a version row. Called once
 *  per file at upload time. Idempotent: if a version row already
 *  exists for this file with `source='upload'`, it is returned
 *  unchanged. */
export async function recordUploadVersion(args: {
  ownerId: string;
  projectId: string;
  fileId: string;
  uploadStorageKey: string;
}): Promise<VersionRow> {
  const supabase = createAdminClient();
  const { data: existing, error: existingErr } = await supabase
    .from("project_document_versions")
    .select("*")
    .eq("file_id", args.fileId)
    .eq("source", "upload")
    .maybeSingle();
  if (existingErr) throw existingErr;
  if (existing) return existing;

  // The upload's storage_key points at the original file blob —
  // versions table does NOT need its own copy; we just record a
  // pointer. The blob is the same one the user uploaded.
  const versionId = crypto.randomUUID();
  const { data, error } = await supabase
    .from("project_document_versions")
    .insert({
      id: versionId,
      project_id: args.projectId,
      file_id: args.fileId,
      source: "upload",
      storage_key: args.uploadStorageKey,
      version_number: 1,
      parent_version_id: null,
      message_id: null,
      issue_id: null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** Storage keys of every version blob attached to a project. Used by
 *  `deleteProject` to clean up. Returns only proposal/accepted blobs —
 *  the upload blob is owned by `files.storage_key` and removed via
 *  the existing file-storage cleanup path. */
export async function listProjectVersionStorageKeys(
  projectId: string,
): Promise<string[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("project_document_versions")
    .select("storage_key, source")
    .eq("project_id", projectId)
    .in("source", ["proposal", "accepted"]);
  if (error) throw error;
  // proposal + accepted rows can SHARE a storage_key after promotion
  // (acceptance reuses the proposal blob), so dedupe before delete.
  return Array.from(new Set((data ?? []).map((r) => r.storage_key)));
}
