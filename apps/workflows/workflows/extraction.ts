import { getLLMCredsForProject } from "@/lib/byok";
import { getLowModel } from "@/lib/model";
import { estimateCostUsd, modelIdForTier } from "@/lib/pricing";
import { createAdminClient } from "@/lib/supabase/admin";
import { propagateAttributes } from "@langfuse/tracing";
import { extract } from "@wargame-esq/extraction";

const CANCELLED_MARKER = "__WARGAME_CANCELLED__";

function isCancelled(err: unknown): boolean {
  return extractErrorMessage(err) === CANCELLED_MARKER;
}

/**
 * Pull a usable error message off whatever was thrown. Handles the
 * three real cases we see in production:
 *   1. Real Error instance — use `.message`.
 *   2. Plain object with a string `.message` — what Vercel Workflows
 *      hands us when a step error is wrapped in FatalError across a
 *      bundle/realm boundary; `instanceof Error` is false but the
 *      message is still there.
 *   3. Everything else — string fallback.
 */
function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  if (typeof err === "string") return err;
  return "Unknown extraction error";
}

/** Short identifier prefix for log breadcrumbs. */
function tag(projectId: string): string {
  return `[extract ${projectId.slice(0, 8)}]`;
}

/**
 * Extraction workflow. Runs via Vercel Workflows (`'use workflow'` /
 * `'use step'`). Each step opens a fresh Supabase admin client and
 * does its DB work via the SDK; the admin key bypasses RLS so
 * workflow steps can read/write arbitrary projects (they're trusted
 * server code; the trigger handshake at start-extraction is the
 * boundary).
 *
 * Reliability rules enforced here:
 *   - Every DB call checks `error` separately from `data`. A query
 *     failure is never silently treated as "row not found."
 *   - Cancellation (CANCELLED_MARKER) is the only kind of error
 *     that hides from the outer catch — and it's only thrown for
 *     a positive cancel signal, not for a DB failure.
 *   - The outer catch always tries to mark the project as failed.
 *     If the failure-marking itself fails, we log loudly rather
 *     than swallowing.
 *   - Stale-state branches log when they no-op so a future operator
 *     can audit why a workflow run apparently finished without an
 *     effect.
 */
export async function extractionWorkflow(projectId: string) {
  "use workflow";

  const t = tag(projectId);
  console.log(`${t} workflow start`);

  try {
    await resetRunUsageStep(projectId);
    const ctx = await loadExtractionContextStep(projectId);
    if (!ctx.project) {
      console.warn(`${t} workflow stop — project not found`);
      return { ok: false, reason: "project_not_found" };
    }
    if (ctx.files.length === 0) {
      console.warn(
        `${t} workflow stop — no converted file content (still pending or all failed?)`,
      );
      await markExtractionFailedStep(
        projectId,
        "No converted file content to extract from. Are the .docx uploads stuck on conversion?",
      );
      return { ok: false, reason: "no_files" };
    }

    await throwIfCancelledStep(projectId);
    const result = await runExtractionStep(projectId, ctx.files);
    await throwIfCancelledStep(projectId);
    await applyExtractionResultStep(projectId, result);
    console.log(`${t} workflow done — parties=${result.parties.length}`);
    return { ok: true };
  } catch (err) {
    if (isCancelled(err)) {
      console.log(`${t} workflow cancelled`);
      try {
        await markCancelledStep(projectId);
      } catch (markErr) {
        console.error(`${t} workflow cancel-mark failed`, markErr);
      }
      return { ok: false, cancelled: true };
    }
    // Vercel Workflows wraps step throws in its own FatalError class
    // which can fail `instanceof Error` checks across realm/bundle
    // boundaries. Fall back to reading `.message` off any object that
    // carries one so the real cause lands in failure_message instead
    // of the useless "Unknown extraction error" sentinel.
    const message = extractErrorMessage(err);
    console.error(`${t} workflow failed — ${message}`, err);
    try {
      await markExtractionFailedStep(projectId, message);
    } catch (markErr) {
      // Secondary failure: the failure-marking write itself errored.
      // Log loudly — if both the primary work AND the failure-mark
      // fail, the project row stays stuck and only this line lets a
      // future operator reconstruct what happened.
      console.error(
        `${t} workflow CRITICAL — failure-mark write also failed; project row may be stuck`,
        markErr,
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExtractionContext {
  project: { id: string; status: string; name: string } | null;
  files: Array<{ name: string; markdownContent: string }>;
}

interface ExtractionResult {
  title: string | null;
  parties: Array<{ name: string; role: string; isPlaceholder: boolean }>;
}

interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  callCount: number;
  estimatedCostUsd: number;
  lastCall?: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedInputTokens: number;
    modelId: string;
  };
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function loadExtractionContextStep(
  projectId: string,
): Promise<ExtractionContext> {
  "use step";
  const supa = createAdminClient();
  const t = tag(projectId);

  const { data: project, error: projectErr } = await supa
    .from("projects")
    .select("id, status, name")
    .eq("id", projectId)
    .maybeSingle();
  if (projectErr) {
    throw new Error(`${t} loadContext: project read failed: ${projectErr.message}`);
  }
  if (!project) return { project: null, files: [] };

  const { data: rows, error: filesErr } = await supa
    .from("files")
    .select("name, markdown_content")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (filesErr) {
    throw new Error(`${t} loadContext: files read failed: ${filesErr.message}`);
  }

  const files = (rows ?? [])
    .filter((f) => (f.markdown_content ?? "").length > 0)
    .map((f) => ({ name: f.name, markdownContent: f.markdown_content ?? "" }));

  return { project, files };
}

async function runExtractionStep(
  projectId: string,
  files: Array<{ name: string; markdownContent: string }>,
): Promise<ExtractionResult> {
  "use step";
  const t = tag(projectId);

  // BYOK lookup. The extraction workflow runs against the project
  // owner's stored key for the snapshotted provider. Dev fallback
  // (DEV_AUTH_BYPASS + NODE_ENV check) is inside getLLMCredsForProject.
  const credsResult = await getLLMCredsForProject(projectId);
  if (!credsResult.ok) {
    throw new Error(
      `${t} extract: could not resolve LLM credentials — ${JSON.stringify(credsResult.error)}`,
    );
  }
  const creds = {
    provider: credsResult.provider,
    apiKey: credsResult.apiKey,
  };

  const startedAt = Date.now();
  console.log(`${t} extract start — files=${files.length} provider=${creds.provider}`);

  const result = await propagateAttributes(
    {
      sessionId: projectId,
      traceName: `extraction-${projectId}`,
    },
    () =>
      extract({
        files,
        model: getLowModel(creds),
        telemetryFunctionId: "extract-project-metadata",
        telemetryMetadata: { projectId },
      }),
  );

  const durationMs = Date.now() - startedAt;
  console.log(
    `${t} extract done — ${durationMs}ms parties=${result.parties.length} title=${result.title ? "yes" : "no"}`,
  );

  if (result.usage.inputTokens > 0 || result.usage.outputTokens > 0) {
    const modelId = modelIdForTier({ tier: "low", provider: creds.provider });
    const cost = estimateCostUsd(modelId, {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });
    try {
      await recordRunUsageStep(projectId, {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        modelId,
        estimatedCostUsd: cost,
      });
    } catch (err) {
      // Usage accounting is non-critical — don't fail the workflow
      // over a missed usage write, but log so we can audit drift.
      console.warn(`${t} extract: recordUsage failed (non-fatal)`, err);
    }
  }

  return {
    title: result.title,
    parties: result.parties.map((p) => ({
      name: p.name,
      role: p.role,
      isPlaceholder: p.isPlaceholder,
    })),
  };
}

async function applyExtractionResultStep(
  projectId: string,
  result: ExtractionResult,
): Promise<void> {
  "use step";
  const supa = createAdminClient();
  const t = tag(projectId);

  const { data: project, error: projectErr } = await supa
    .from("projects")
    .select("status")
    .eq("id", projectId)
    .maybeSingle();
  if (projectErr) {
    throw new Error(
      `${t} applyResult: project read failed: ${projectErr.message}`,
    );
  }
  if (!project) {
    console.warn(`${t} applyResult: project no longer exists; skipping`);
    return;
  }
  if (project.status !== "extracting") {
    console.warn(
      `${t} applyResult: stale status=${project.status} (expected "extracting"); skipping`,
    );
    return;
  }

  // Drop any partial earlier-run parties; rerun is idempotent.
  const { error: deleteErr } = await supa
    .from("project_parties")
    .delete()
    .eq("project_id", projectId);
  if (deleteErr) {
    throw new Error(
      `${t} applyResult: party clear failed: ${deleteErr.message}`,
    );
  }

  if (result.parties.length > 0) {
    // is_user_side intentionally omitted — stays NULL until the
    // user confirms parties via the setup form.
    const rows = result.parties.map((p, i) => ({
      project_id: projectId,
      side: i,
      name: p.name,
      role: p.role,
      is_placeholder: p.isPlaceholder,
    }));
    const { error: insertErr } = await supa
      .from("project_parties")
      .insert(rows);
    if (insertErr) {
      throw new Error(
        `${t} applyResult: party insert failed: ${insertErr.message}`,
      );
    }
  }

  const { error: updateErr } = await supa
    .from("projects")
    .update({
      status: "ready_for_interview",
      failure_message: null,
      ...(result.title ? { name: result.title } : {}),
    })
    .eq("id", projectId);
  if (updateErr) {
    throw new Error(
      `${t} applyResult: project status update failed: ${updateErr.message}`,
    );
  }
}

async function markExtractionFailedStep(
  projectId: string,
  message: string,
): Promise<void> {
  "use step";
  const supa = createAdminClient();
  const t = tag(projectId);

  // Drop the status filter. Earlier code only updated when status was
  // still "extracting" — which makes any out-of-band status change
  // silently no-op the failure-mark, leaving the user stuck. If the
  // workflow says "this failed", we always make sure that's recorded.
  const { error } = await supa
    .from("projects")
    .update({
      status: "failed",
      failure_message: message,
    })
    .eq("id", projectId);
  if (error) {
    // Bubble up so the outer catch in extractionWorkflow can log it
    // as a CRITICAL secondary failure.
    throw new Error(
      `${t} markFailed: project update failed: ${error.message}`,
    );
  }
}

async function throwIfCancelledStep(projectId: string): Promise<void> {
  "use step";
  const supa = createAdminClient();
  const t = tag(projectId);

  const { data: row, error } = await supa
    .from("projects")
    .select("cancel_requested_at, status")
    .eq("id", projectId)
    .maybeSingle();

  // A DB error is NOT cancellation. Older code did `if (!row) throw
  // CANCELLED_MARKER`, which conflated "no row found" with "DB query
  // errored". A blip would surface as "user cancelled the run",
  // which is confusing and wrong. Now: error throws as a regular
  // error (workflow catch handles it as failure); only a real
  // cancel signal yields CANCELLED_MARKER.
  if (error) {
    throw new Error(`${t} cancel-check: project read failed: ${error.message}`);
  }
  if (!row) {
    throw new Error(`${t} cancel-check: project no longer exists`);
  }
  if (row.cancel_requested_at) {
    throw new Error(CANCELLED_MARKER);
  }
}

async function markCancelledStep(projectId: string): Promise<void> {
  "use step";
  const supa = createAdminClient();
  const t = tag(projectId);

  // `completed_at` was dropped in plan 07 step 7b — message
  // bookkeeping now lives inside the `message` jsonb metadata.
  const { error: msgErr } = await supa
    .from("messages")
    .update({ status: "failed" })
    .eq("project_id", projectId)
    .eq("status", "streaming");
  if (msgErr) {
    console.warn(`${t} markCancelled: messages update failed`, msgErr);
  }

  const { error: projErr } = await supa
    .from("projects")
    .update({
      status: "cancelled",
      completed_at: new Date().toISOString(),
      failure_message: "Cancelled by user.",
    })
    .eq("id", projectId);
  if (projErr) {
    throw new Error(
      `${t} markCancelled: project update failed: ${projErr.message}`,
    );
  }
}

async function recordRunUsageStep(
  projectId: string,
  call: {
    inputTokens: number;
    outputTokens: number;
    modelId: string;
    estimatedCostUsd: number;
  },
): Promise<void> {
  "use step";
  const supa = createAdminClient();
  const t = tag(projectId);

  const { data: project, error: readErr } = await supa
    .from("projects")
    .select("run_usage")
    .eq("id", projectId)
    .maybeSingle();
  if (readErr) {
    throw new Error(`${t} recordUsage: read failed: ${readErr.message}`);
  }
  if (!project) {
    console.warn(`${t} recordUsage: project no longer exists; skipping`);
    return;
  }
  const prev: RunUsage =
    (project.run_usage as RunUsage | null) ?? {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedInputTokens: 0,
      callCount: 0,
      estimatedCostUsd: 0,
      updatedAt: 0,
    };
  const next: RunUsage = {
    inputTokens: prev.inputTokens + call.inputTokens,
    outputTokens: prev.outputTokens + call.outputTokens,
    reasoningTokens: prev.reasoningTokens ?? 0,
    cachedInputTokens: prev.cachedInputTokens ?? 0,
    callCount: prev.callCount + 1,
    estimatedCostUsd: prev.estimatedCostUsd + call.estimatedCostUsd,
    lastCall: {
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      reasoningTokens: 0,
      cachedInputTokens: 0,
      modelId: call.modelId,
    },
    updatedAt: Date.now(),
  };
  const { error: updateErr } = await supa
    .from("projects")
    // The Database types want a strict Json shape; our RunUsage type
    // is structurally compatible but TS can't see that without help.
    .update({ run_usage: next as unknown as never })
    .eq("id", projectId);
  if (updateErr) {
    throw new Error(`${t} recordUsage: update failed: ${updateErr.message}`);
  }
}

async function resetRunUsageStep(projectId: string): Promise<void> {
  "use step";
  const supa = createAdminClient();
  const t = tag(projectId);

  const { error } = await supa
    .from("projects")
    .update({
      run_usage: {
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        callCount: 0,
        estimatedCostUsd: 0,
        updatedAt: Date.now(),
      },
      cancel_requested_at: null,
    })
    .eq("id", projectId);
  if (error) {
    throw new Error(`${t} resetUsage: project update failed: ${error.message}`);
  }
}
