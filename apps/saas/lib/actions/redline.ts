"use server";

// Server actions for the PoC redline affordance.
//
// `getRedlineUrl` mints a fresh signed read URL for the compiled
// `.docx` produced by the drafting phase. The storage key lives on
// a `data-redline` part in the run message's `message.parts` jsonb,
// which is RLS-scoped to the project owner — but the action also
// receives the key over the wire, so we must defend against the
// caller substituting a key from a project they don't own.
//
// Two layered checks:
//   1. requireProjectById — RLS-gated read; non-owner gets 404.
//   2. prefix check — the redline pipeline writes keys at
//      `<ownerId>/<projectId>/redline-...`. After (1) we know the
//      owner/project, so the key must live under that prefix.
// Without (2) a user who owns project A could pass storageKey from
// project B and get a signed URL to B's output.

import { requireProjectById } from "@/lib/auth-session";
import { createSignedRead } from "@/lib/storage";

export type RedlineUrlMode = "view" | "download";

export async function getRedlineUrl(args: {
  projectId: string;
  storageKey: string;
  downloadFilename: string;
  mode?: RedlineUrlMode;
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
    console.warn("[redline action] storage-key prefix mismatch", {
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
    console.error("[redline action] sign failed", {
      projectId,
      err,
    });
    return { error: "sign-failed" };
  }
}
