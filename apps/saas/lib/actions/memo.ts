"use server";

// Server action for the PoC memo affordance. Mirrors getRedlineUrl.
// Two layered checks (see redline.ts for the longer rationale):
//   1. requireProjectById — RLS-gated; non-owner gets 404.
//   2. prefix check — the memo pipeline writes keys at
//      `<ownerId>/<projectId>/memo-...`. Without (2) a user could
//      pass a storage key from a project they don't own.

import { requireProjectById } from "@/lib/auth-session";
import { createSignedRead } from "@/lib/storage";

export type MemoUrlMode = "view" | "download";

export async function getMemoUrl(args: {
  projectId: string;
  storageKey: string;
  downloadFilename: string;
  mode?: MemoUrlMode;
}): Promise<{ url: string } | { error: string }> {
  const { projectId, storageKey, downloadFilename } = args;
  const mode = args.mode ?? "view";

  let project: { owner_id: string };
  try {
    const { project: p } = await requireProjectById(projectId);
    project = p;
  } catch {
    return { error: "forbidden" };
  }

  const expectedPrefix = `${project.owner_id}/${projectId}/`;
  if (!storageKey.startsWith(expectedPrefix)) {
    console.warn("[memo action] storage-key prefix mismatch", {
      projectId,
      owner: project.owner_id,
    });
    return { error: "forbidden" };
  }

  try {
    const url = await createSignedRead(storageKey, 120, {
      downloadFilename: mode === "download" ? downloadFilename : undefined,
    });
    return { url };
  } catch (err) {
    console.error("[memo action] sign failed", {
      projectId,
      err,
    });
    return { error: "sign-failed" };
  }
}
