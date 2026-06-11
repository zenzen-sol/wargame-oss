"use server";
// Project lifecycle. RLS does most of the heavy lifting — `update`
// statements only touch rows the caller owns. The server actions
// keep the state-machine guards (e.g. only retry from `failed`)
// because RLS doesn't know about app semantics.
import {
  requireProjectById,
  requireUser,
  requireUserWithDisclaimer,
} from "@/lib/auth-session";
import { PROJECTS_PER_USER_MAX } from "@/lib/project-limits";
import { createClient } from "@/lib/supabase/server";
import { generateSlug, untitledProjectName } from "@/lib/slug";
import { deleteObject } from "@/lib/storage";
import { listProjectVersionStorageKeys } from "@/lib/working-draft";
import { revalidatePath } from "next/cache";

// Pure cache buster invoked from useProjectRealtime when a Postgres
// change arrives that wasn't initiated by a local server action.
// `revalidatePath` invalidates the data cache; Next streams down
// updated server-component output to the client.
export async function revalidateProjectBySlug(slug: string): Promise<void> {
  console.log(
    `[revalidate] revalidateProjectBySlug slug=${slug} @ ${new Date().toISOString()}`,
  );
  revalidatePath(`/projects/${slug}`);
  revalidatePath("/");
}

export async function createProject(): Promise<{
  id: string;
  slug: string;
}> {
  // Disclaimer ack is a TOS / legal pre-req for creating new work in
  // the app. Layout-level redirect catches the navigation path; this
  // guards direct server-action invocation.
  const user = await requireUserWithDisclaimer();
  const supabase = await createClient();

  // Check the cap up front so the user gets a clean error message
  // instead of a Postgres trigger exception leaking through.
  const { count, error: countErr } = await supabase
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", user.id);
  if (countErr) throw countErr;
  if ((count ?? 0) >= PROJECTS_PER_USER_MAX) {
    throw new Error(
      `You've reached the ${PROJECTS_PER_USER_MAX}-project limit. Archive or delete a project before creating another.`,
    );
  }

  // URL slug — opaque random base32 so cross-tenant enumeration is
  // infeasible. Collision space ~6.5e11; retry defensively.
  let slug = generateSlug();
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: existing } = await supabase
      .from("projects")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (!existing) break;
    slug = generateSlug();
    if (attempt === 4) {
      throw new Error("Failed to allocate a unique project slug.");
    }
  }

  // Human-readable per-owner display id (WG-<n>).
  const { data: displayId, error: displayErr } = await supabase.rpc(
    "next_user_project_display_id",
    { p_owner: user.id },
  );
  if (displayErr) throw displayErr;
  if (!displayId) throw new Error("Failed to allocate a project display id.");

  // Snapshot LLM provider at create time. The workflows extraction
  // step reads this to look up the owner's stored key (BYOK). The
  // snapshot is immutable for this project's lifetime so every turn
  // runs on the same model family — switching mid-project would
  // split the run history across two providers.
  //
  // The chosen provider is the user's default-flagged key. If no
  // default is flagged but exactly one key is configured, use it
  // (covers the "first key just saved" path before the user hits
  // the default selector). Zero keys → clear error rather than a
  // workflow-time failure.
  const { data: keyRows, error: keysErr } = await supabase
    .from("user_api_keys")
    .select("provider, is_default")
    .eq("user_id", user.id);
  if (keysErr) throw keysErr;
  const rows = keyRows ?? [];
  const defaultRow = rows.find((r) => r.is_default);
  const onlyRow = rows.length === 1 ? rows[0] : null;
  const provider: "openai" | "anthropic" | null =
    (defaultRow?.provider as "openai" | "anthropic" | undefined) ??
    (onlyRow ? (onlyRow.provider as "openai" | "anthropic") : null);
  if (!provider) {
    throw new Error(
      rows.length === 0
        ? "Add an API key in Settings → API keys before creating a project."
        : "Pick a default provider in Settings → API keys before creating a project.",
    );
  }

  const { data, error } = await supabase
    .from("projects")
    .insert({
      owner_id: user.id,
      name: untitledProjectName(),
      status: "draft",
      slug,
      display_id: displayId,
      provider,
    })
    .select("id, slug")
    .single();
  if (error) throw error;
  if (!data.slug) throw new Error("Project created without a slug.");
  revalidatePath("/");
  return { id: data.id, slug: data.slug };
}

/** Override the project's snapshotted LLM provider before extraction
 *  has started. The picker on the file-setup scene calls this when
 *  the user switches between their configured providers; once the
 *  project leaves `draft` the snapshot is locked (a run's history
 *  must stay on a single model family).
 *
 *  Gates: the project must be in `draft`, owned by the caller (RLS
 *  enforces this), and the user must already have a key for the
 *  chosen provider — we don't let the picker stage a provider the
 *  user hasn't configured. */
export async function setProjectProvider(input: {
  projectId: string;
  provider: "openai" | "anthropic";
}): Promise<void> {
  if (input.provider !== "openai" && input.provider !== "anthropic") {
    throw new Error(`Unknown provider: ${input.provider}`);
  }
  const user = await requireUser();
  const supabase = await createClient();

  // Verify the user has a key for this provider. The picker UI
  // already filters to configured providers, but a direct action
  // call shouldn't be able to slot in an un-keyed snapshot.
  const { data: keyRow, error: keyErr } = await supabase
    .from("user_api_keys")
    .select("provider")
    .eq("user_id", user.id)
    .eq("provider", input.provider)
    .maybeSingle();
  if (keyErr) throw keyErr;
  if (!keyRow) {
    throw new Error(
      "Add a key for that provider in Settings → API keys first.",
    );
  }

  // Status guard: only mutable while still `draft`. Past that the
  // snapshot is load-bearing for in-flight or completed runs.
  const { data: project, error: readErr } = await supabase
    .from("projects")
    .select("status, slug")
    .eq("id", input.projectId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!project) throw new Error("Not found.");
  if (project.status !== "draft") {
    throw new Error(
      "Provider is locked once the contract is being read.",
    );
  }

  const { error } = await supabase
    .from("projects")
    .update({ provider: input.provider })
    .eq("id", input.projectId);
  if (error) throw error;

  if (project.slug) revalidatePath(`/projects/${project.slug}`);
}

export async function renameProject(input: {
  id: string;
  name: string;
}): Promise<void> {
  const trimmed = input.name.trim();
  if (trimmed.length === 0) throw new Error("Project name cannot be empty.");
  if (trimmed.length > 200) throw new Error("Project name is too long.");
  const supabase = await createClient();
  const { error, data } = await supabase
    .from("projects")
    .update({ name: trimmed })
    .eq("id", input.id)
    .select("slug")
    .maybeSingle();
  if (error) throw error;
  revalidatePath("/");
  if (data?.slug) revalidatePath(`/projects/${data.slug}`);
}

export async function archiveProject(input: { id: string }): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", input.id)
    .is("archived_at", null);
  if (error) throw error;
  revalidatePath("/");
}

// Hard delete: removes the project row (FK cascades take care of
// files/parties/interview_answers/issues/messages/outputs in the DB)
// AND empties the project's blob in storage. Use only when the user
// explicitly opts in via the confirmation dialog — archive is the
// reversible default.
export async function deleteProject(input: { id: string }): Promise<void> {
  // Ownership gate. `listProjectVersionStorageKeys` and `deleteObject`
  // both run on the admin client and would happily destroy another
  // tenant's blobs if we trusted the input id. requireProjectById
  // reads through RLS — a non-owner gets a 404 and never reaches the
  // admin paths below.
  await requireProjectById(input.id);

  const supabase = await createClient();
  // Read storage keys before the DB delete cascades file rows away.
  const { data: files, error: filesErr } = await supabase
    .from("files")
    .select("storage_key")
    .eq("project_id", input.id);
  if (filesErr) throw filesErr;

  // Working-draft version blobs (proposal + accepted .docx files) sit
  // in storage but aren't reachable from the files table — list them
  // explicitly before the DB cascade clears their rows.
  const versionKeys = await listProjectVersionStorageKeys(input.id).catch(
    (err): string[] => {
      console.warn("[deleteProject listVersions]", err);
      return [];
    },
  );
  for (const key of [
    ...(files ?? []).map((f) => f.storage_key),
    ...versionKeys,
  ]) {
    await deleteObject(key).catch((err) =>
      console.warn("[deleteProject deleteObject]", key, err),
    );
  }

  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", input.id);
  if (error) throw error;
  revalidatePath("/");
}

async function getProjectSlug(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("projects")
    .select("slug")
    .eq("id", projectId)
    .maybeSingle();
  return data?.slug ?? null;
}

// Defer the issue currently in `in_negotiation` so the auto-fire
// loop moves on to the next one. `reason` is kept open-ended so the
// UI can pass user-friendly text (e.g. "Skipped by user").
export async function skipCurrentIssue(input: {
  projectId: string;
  reason: string;
}): Promise<{ skipped: boolean }> {
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("issues")
    .select("id")
    .eq("project_id", input.projectId)
    .eq("status", "in_negotiation");
  if (error) throw error;
  const target = rows?.[0];
  if (!target) return { skipped: false };
  const { error: updateErr } = await supabase
    .from("issues")
    .update({
      status: "deferred",
      resolution: { kind: "deferred", reason: input.reason },
    })
    .eq("id", target.id);
  if (updateErr) throw updateErr;
  const slug = await getProjectSlug(supabase, input.projectId);
  if (slug) revalidatePath(`/projects/${slug}`);
  return { skipped: true };
}

// Drop the last argument turn on the current issue so the auto-fire
// loop re-runs the same side. Used when the latest turn was bad
// (hallucination, stalled, off-topic) and the user wants a do-over.
// We delete the row rather than soft-delete because the message log
// is already a derivative artifact — the chat route reads `messages`
// to build context, so a phantom row would distort future turns.
export async function retryLastTurn(input: {
  projectId: string;
}): Promise<{ retried: boolean }> {
  const supabase = await createClient();
  const { data: issueRows, error: issueErr } = await supabase
    .from("issues")
    .select("id")
    .eq("project_id", input.projectId)
    .eq("status", "in_negotiation");
  if (issueErr) throw issueErr;
  const issue = issueRows?.[0];
  if (!issue) return { retried: false };
  // `issue_id` is set only on argument turns, so filtering by it is
  // sufficient — no need to filter on the legacy `role` column. This
  // also survives plan 07 step 7b (drop the parsed `role` column).
  const { data: lastArg, error: argErr } = await supabase
    .from("messages")
    .select("id")
    .eq("project_id", input.projectId)
    .eq("issue_id", issue.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (argErr) throw argErr;
  if (!lastArg) return { retried: false };
  const { error: deleteErr } = await supabase
    .from("messages")
    .delete()
    .eq("id", lastArg.id);
  if (deleteErr) throw deleteErr;
  const slug = await getProjectSlug(supabase, input.projectId);
  if (slug) revalidatePath(`/projects/${slug}`);
  return { retried: true };
}

export async function requestCancel(input: {
  projectId: string;
}): Promise<{ accepted: boolean }> {
  const supabase = await createClient();
  const { data: project, error: readErr } = await supabase
    .from("projects")
    .select("status, slug")
    .eq("id", input.projectId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!project) return { accepted: false };

  // Convex-era two-phase cancel collapsed: every cancellable run
  // flips straight to `cancelled`. The chat route's abort signal
  // handles in-flight stream teardown synchronously.
  if (
    project.status === "extracting" ||
    project.status === "reviewing" ||
    project.status === "negotiating"
  ) {
    const { error } = await supabase
      .from("projects")
      .update({
        status: "cancelled",
        cancel_requested_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .eq("id", input.projectId);
    if (error) throw error;
    if (project.slug) revalidatePath(`/projects/${project.slug}`);
    return { accepted: true };
  }

  return { accepted: false };
}

export async function retryExtraction(input: {
  projectId: string;
}): Promise<void> {
  const supabase = await createClient();
  const { data: project, error: readErr } = await supabase
    .from("projects")
    .select("status, slug")
    .eq("id", input.projectId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!project) throw new Error("Not found.");
  if (project.status !== "failed") {
    throw new Error(
      `Cannot retry from status '${project.status}'. Only 'failed' projects can be retried.`,
    );
  }
  // RLS scopes both deletes to the caller; if any row escapes we'd
  // get an RLS error rather than a silent leak.
  await supabase
    .from("project_parties")
    .delete()
    .eq("project_id", input.projectId);
  const { error } = await supabase
    .from("projects")
    .update({ status: "draft", failure_message: null })
    .eq("id", input.projectId);
  if (error) throw error;
  if (project.slug) revalidatePath(`/projects/${project.slug}`);
}

