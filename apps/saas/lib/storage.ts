// Supabase Storage helpers. Uses the admin client because we mint
// signed upload URLs and read raw object bytes from the workflow —
// both operations need to bypass per-user RLS. The browser PUTs to
// the signed URLs but never wields a key directly.
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "project-files";

export function projectFileKey(args: {
  ownerId: string;
  projectId: string;
  fileId: string;
  name: string;
}): string {
  // Owner uuid prefix is load-bearing for the Storage RLS policies
  // (`(storage.foldername(name))[1] = auth.uid()::text`). Don't move it.
  const safe = args.name.replace(/[^a-zA-Z0-9_.-]/g, "_");
  return `${args.ownerId}/${args.projectId}/${args.fileId}-${safe}`;
}

/** Storage key for a working-draft version of an uploaded file.
 *  Sibling to `projectFileKey` under the same owner prefix so the
 *  Storage RLS policy applies unchanged. Can't collide with an upload
 *  key — uploads use a sanitized filename suffix; versions always use
 *  `v<uuid>.docx`. */
export function projectFileVersionKey(args: {
  ownerId: string;
  projectId: string;
  fileId: string;
  versionId: string;
}): string {
  return `${args.ownerId}/${args.projectId}/${args.fileId}-v${args.versionId}.docx`;
}

export async function createSignedUpload(storageKey: string): Promise<{
  signedUrl: string;
  token: string;
  path: string;
}> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(storageKey);
  if (error || !data) {
    throw new Error(`Failed to mint upload URL: ${error?.message ?? "unknown"}`);
  }
  return data;
}

export async function createSignedRead(
  storageKey: string,
  expiresInSeconds = 3600,
  options: { downloadFilename?: string } = {},
): Promise<string> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storageKey, expiresInSeconds, {
      download: options.downloadFilename ?? false,
    });
  if (error || !data) {
    throw new Error(`Failed to mint read URL: ${error?.message ?? "unknown"}`);
  }
  return data.signedUrl;
}

export async function downloadObject(storageKey: string): Promise<ArrayBuffer> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(storageKey);
  if (error || !data) {
    throw new Error(`Failed to download: ${error?.message ?? "unknown"}`);
  }
  return await data.arrayBuffer();
}

export async function deleteObject(storageKey: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.storage.from(BUCKET).remove([storageKey]);
  if (error) throw new Error(`Failed to delete: ${error.message}`);
}

/** Direct server-side upload of raw bytes. Used by the redline
 *  compile step to persist a generated .docx without round-tripping
 *  through the browser. Overwrites silently if the key exists.
 *  Mirrors the working-draft writer pattern. */
export async function uploadObject(
  storageKey: string,
  bytes: Uint8Array | Buffer,
  contentType: string,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.storage.from(BUCKET).upload(
    storageKey,
    bytes,
    {
      contentType,
      upsert: true,
    },
  );
  if (error) throw new Error(`Failed to upload: ${error.message}`);
}
