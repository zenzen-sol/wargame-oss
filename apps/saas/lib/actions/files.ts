"use server";
// File-upload actions. The user-facing flow:
//   1. UI calls generateFileUpload — server insert + signed URL.
//   2. Browser PUTs the .docx blob to the signed URL.
//   3. UI calls attachFile — fires conversion via the workflow trigger.
import {
  requireUser,
  requireUserWithDisclaimer,
} from "@/lib/auth-session";
import { featureMultiFileContracts } from "@/lib/feature-flags";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  createSignedUpload,
  deleteObject,
  projectFileKey,
} from "@/lib/storage";
import { recordUploadVersion } from "@/lib/working-draft";
import { revalidatePath } from "next/cache";
import { after } from "next/server";

// 1 MB. Largest contract tested is 207 KB; this gives ~5x headroom.
// Enforced here (trusted), at the Supabase Storage bucket policy
// (last line of defense), AND in the upload UI (UX nicety, not
// security). Keep the three in sync if you change it.
const MAX_FILE_BYTES = 1_048_576;

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function generateFileUpload(input: {
  projectId: string;
  name: string;
  mimeType: string;
  byteSize: number;
}): Promise<{
  fileId: string;
  storageKey: string;
  signedUrl: string;
  token: string;
}> {
  const user = await requireUser();

  // Reject oversized uploads before signing a URL. byteSize is
  // client-supplied (advisory); the Storage bucket's file_size_limit
  // enforces the real cap on the actual blob.
  if (
    !Number.isFinite(input.byteSize) ||
    input.byteSize < 1 ||
    input.byteSize > MAX_FILE_BYTES
  ) {
    throw new Error(
      `File is ${(input.byteSize / 1024).toFixed(1)} KB; cap is ${MAX_FILE_BYTES / 1024} KB. Trim or split the document.`,
    );
  }

  // Only .docx. mimeType is also client-supplied (advisory) but a
  // mismatch here means UI is wrong or someone's poking around — fail
  // before consuming Storage + extraction cycles.
  if (input.mimeType && input.mimeType !== DOCX_MIME) {
    throw new Error(
      "Only .docx files are supported. Convert other formats before uploading.",
    );
  }

  // Per-user conversion rate limit. Each accepted upload triggers a
  // Vercel-Workflows conversion. 5/min burst handles legit batch
  // uploads; 150/day stops a daily-grind abuser.
  const verdict = await checkRateLimit({
    userId: user.id,
    bucket: "conversion",
  });
  if (!verdict.allowed) {
    throw new Error(
      `Too many file uploads. Try again in ${verdict.retryAfterSec}s.`,
    );
  }

  const supabase = await createClient();

  // Multi-file contracts gate. The run pipeline (chat route,
  // drafter, redline / memo compile) is single-file by deep
  // assumption. Reject
  // additional files before signing an upload URL so the UI's
  // gating can't be bypassed by a direct action call.
  if (!featureMultiFileContracts.serverEnabled()) {
    const { count, error: countErr } = await supabase
      .from("files")
      .select("id", { count: "exact", head: true })
      .eq("project_id", input.projectId);
    if (countErr) throw countErr;
    if ((count ?? 0) >= 1) {
      throw new Error(
        "Multi-file contracts aren't enabled. This project already has a file; remove it before uploading a different one.",
      );
    }
  }

  const fileId = crypto.randomUUID();
  const storageKey = projectFileKey({
    ownerId: user.id,
    projectId: input.projectId,
    fileId,
    name: input.name,
  });
  const signed = await createSignedUpload(storageKey);

  const { error } = await supabase.from("files").insert({
    id: fileId,
    project_id: input.projectId,
    storage_key: storageKey,
    name: input.name,
    mime_type: input.mimeType,
    byte_size: input.byteSize,
    conversion_status: "pending",
  });
  if (error) throw error;

  const { data: project } = await supabase
    .from("projects")
    .select("slug")
    .eq("id", input.projectId)
    .maybeSingle();
  if (project?.slug) revalidatePath(`/projects/${project.slug}`);

  return {
    fileId,
    storageKey,
    signedUrl: signed.signedUrl,
    token: signed.token,
  };
}

export async function attachFile(input: { fileId: string }): Promise<void> {
  // Attaching a file kicks off the conversion workflow and counts
  // against the user's cost budget; gate on disclaimer ack.
  await requireUserWithDisclaimer();
  // Read just to validate ownership via RLS — and to grab the
  // project_id + storage_key for the working-draft V1 row.
  const supabase = await createClient();
  const { data: file, error } = await supabase
    .from("files")
    .select("id, project_id, storage_key")
    .eq("id", input.fileId)
    .maybeSingle();
  if (error) throw error;
  if (!file) throw new Error("File not found.");

  // Record the upload as V1 of the file's working-draft chain so that
  // when the negotiation starts the chat route can build the baseline
  // view by reading these bytes. Idempotent — re-runs are no-ops.
  const { data: project } = await supabase
    .from("projects")
    .select("owner_id")
    .eq("id", file.project_id)
    .maybeSingle();
  if (project?.owner_id) {
    await recordUploadVersion({
      ownerId: project.owner_id,
      projectId: file.project_id,
      fileId: file.id,
      uploadStorageKey: file.storage_key,
    }).catch((err) =>
      console.warn("[attachFile recordUploadVersion]", err),
    );
  }

  await triggerConversionAfter({
    fileId: file.id,
    projectId: file.project_id,
  });
}

/** Re-fire the conversion workflow for a file that's stuck (the
 *  trigger fetch errored, the workflow crashed, or it's been
 *  pending for too long). Resets the row back to pending and
 *  re-runs the same `after()` trigger flow used at first attach. */
export async function retryFileConversion(input: {
  fileId: string;
}): Promise<void> {
  await requireUserWithDisclaimer();
  const supabase = await createClient();

  // RLS gates the select; if the user doesn't own the file (via
  // project owner_id), this returns null and we throw.
  const { data: file, error } = await supabase
    .from("files")
    .select("id, project_id, conversion_status")
    .eq("id", input.fileId)
    .maybeSingle();
  if (error) throw error;
  if (!file) throw new Error("File not found.");

  // Only retry-able from a settled state — pending rows that haven't
  // hit the stuck TTL might still be legitimately mid-conversion.
  // The UI surfaces the Retry button after the TTL elapses or when
  // status is `failed`; this is the trusted backstop.
  if (
    file.conversion_status !== "failed" &&
    file.conversion_status !== "pending"
  ) {
    throw new Error(
      `Cannot retry conversion from status '${file.conversion_status}'.`,
    );
  }

  // Reset to pending + clear any prior error message before re-firing
  // the trigger, so the UI flips back into the shimmer/converting
  // state immediately.
  const admin = createAdminClient();
  const { error: updErr } = await admin
    .from("files")
    .update({ conversion_status: "pending", conversion_error: null })
    .eq("id", file.id);
  if (updErr) throw updErr;

  await triggerConversionAfter({
    fileId: file.id,
    projectId: file.project_id,
  });

  const { data: project } = await admin
    .from("projects")
    .select("slug")
    .eq("id", file.project_id)
    .maybeSingle();
  if (project?.slug) revalidatePath(`/projects/${project.slug}`);
}

/** Shared trigger-fire path used by both first attach and retry.
 *  Fires inside `after()` so the request can return immediately
 *  while the workflows fetch completes in the background.
 *
 *  Crucially: when the fetch fails (workflows app down, network
 *  error, or non-2xx), mark the file `failed` with a user-readable
 *  error message so the UI's FileRow renders the failure state and
 *  the user gets a Retry button — rather than the row sitting at
 *  `pending` forever. */
async function triggerConversionAfter(opts: {
  fileId: string;
  projectId: string;
}): Promise<void> {
  const triggerUrl = process.env.WORKFLOW_TRIGGER_URL;
  const authToken = process.env.WORKFLOW_AUTH_TOKEN;
  if (!triggerUrl || !authToken) return;

  after(async () => {
    let errorMessage: string | null = null;
    try {
      const res = await fetch(`${triggerUrl}/start-conversion`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileId: opts.fileId, authToken }),
      });
      if (!res.ok) {
        errorMessage = `Conversion service returned ${res.status}.`;
        console.warn(
          `[triggerConversion non-2xx] status=${res.status} fileId=${opts.fileId.slice(0, 8)}`,
        );
      }
    } catch (err) {
      // Most common: ECONNREFUSED when the workflows app isn't
      // running. Don't leak the raw cause to the UI — the user
      // doesn't need our stack trace.
      errorMessage = "Couldn't reach the conversion service.";
      console.warn(
        `[triggerConversion fetch failed] fileId=${opts.fileId.slice(0, 8)}`,
        err,
      );
    }

    if (errorMessage) {
      const admin = createAdminClient();
      const { error: updErr } = await admin
        .from("files")
        .update({
          conversion_status: "failed",
          conversion_error: errorMessage,
        })
        .eq("id", opts.fileId);
      if (updErr) {
        console.warn(
          `[triggerConversion mark-failed failed] fileId=${opts.fileId.slice(0, 8)}`,
          updErr,
        );
        return;
      }
      // Push the failed state to the UI without waiting for the
      // user's next Realtime tick.
      const { data: project } = await admin
        .from("projects")
        .select("slug")
        .eq("id", opts.projectId)
        .maybeSingle();
      if (project?.slug) revalidatePath(`/projects/${project.slug}`);
    }
  });
}

export async function removeFile(input: { fileId: string }): Promise<void> {
  const supabase = await createClient();
  const { data: file } = await supabase
    .from("files")
    .select("id, storage_key, project_id")
    .eq("id", input.fileId)
    .maybeSingle();
  if (!file) return;

  await deleteObject(file.storage_key).catch((err) =>
    console.warn("[removeFile deleteObject]", err),
  );
  const { error } = await supabase
    .from("files")
    .delete()
    .eq("id", input.fileId);
  if (error) throw error;

  const { data: project } = await supabase
    .from("projects")
    .select("slug")
    .eq("id", file.project_id)
    .maybeSingle();
  if (project?.slug) revalidatePath(`/projects/${project.slug}`);
}
