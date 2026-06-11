// One assistant message per run, written as a single
// `createUIMessageStream` whose `execute` runs the whole negotiation
// in sequence.
//
// Out of scope here:
//   - propose_clause_edit / accept_proposal / mark_impasse (arguments
//     are prose-only).
//   - Resolution detection / early termination.
//   - Anything writing per-turn rows. One row is persisted in
//     `onFinish` with the entire run.
//
// In dev mode `maxDuration` is unenforced; in deployment the cap is
// Vercel-tier-dependent (see plan 08, "Cannot validate" section).

import * as Sentry from "@sentry/nextjs";
import { langfuseSpanProcessor } from "@/instrumentation";
import {
  requireProjectById,
  requireUserWithDisclaimer,
} from "@/lib/auth-session";
import {
  type GetApiKeyError,
  type Provider,
  getApiKeyForProject,
} from "@/lib/byok";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { compileMemo } from "@/lib/memo-compile";
import { compileRedline, loadOriginalDocx } from "@/lib/redline-compile";
import { createAdminClient } from "@/lib/supabase/admin";
import { propagateAttributes } from "@langfuse/tracing";
import {
  BLUE_NEGOTIATION_PROMPT,
  BLUE_SYSTEM_PROMPT,
  DRAFTER_SYSTEM_PROMPT,
  type DrafterBrief,
  type DrafterContext,
  MEMO_SYSTEM_PROMPT,
  type MemoAgreedInput,
  type MemoContext,
  type MemoNotYetDiscussedInput,
  type MemoOpenInput,
  type NegotiationContext,
  type NegotiationTurn,
  RED_NEGOTIATION_PROMPT,
  RED_SYSTEM_PROMPT,
  type ReviewContext,
  type ReviewIssue,
  type SupervisorPlaceholder,
  buildBlueUserPromptParts,
  buildDrafterPromptParts,
  buildMemoPrompt,
  buildNegotiationUserPromptParts,
  buildRedUserPromptParts,
  createDrafterTools,
  estimateCostUsd,
  memoTools,
  resolveModelForTier,
  reviewSchema,
  reviewTools,
  runSupervisor,
  submitEditsSchema,
  submitMemoSchema,
} from "@wargame-esq/agents";
import type { WargameUIMessage } from "@/lib/ui-message";
import type { Tables } from "@/types/database.types";
import {
  type LanguageModelUsage,
  type UIMessage,
  createUIMessageStream,
  createUIMessageStreamResponse,
  hasToolCall,
  streamText,
} from "ai";

export const runtime = "nodejs";
export const maxDuration = 300;

type Project = Tables<"projects">;
type Issue = Tables<"issues">;

const SEVERITY_RANK: Record<Issue["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** Pull a status code + client-safe message out of whatever streamText
 *  / compile threw. Sentry gets the raw error; this is just for the
 *  UI part and console logs. AI SDK errors have a top-level
 *  `statusCode` (e.g. `APICallError`); provider SDKs sometimes use
 *  `status`. Falls back to null. */
function extractPhaseError(err: unknown): { status: number | null; message: string } {
  const status =
    typeof err === "object" && err !== null
      ? typeof (err as { statusCode?: unknown }).statusCode === "number"
        ? ((err as { statusCode: number }).statusCode)
        : typeof (err as { status?: unknown }).status === "number"
          ? ((err as { status: number }).status)
          : null
      : null;
  const raw = err instanceof Error ? err.message : String(err);
  let message: string;
  if (status === 529 || status === 503) {
    message = "The model provider is temporarily overloaded. Try this run again in a minute.";
  } else if (status === 429) {
    message = "The model provider rate-limited this run. Wait a moment and try again.";
  } else if (status === 401 || status === 403) {
    message = "The provider rejected the API key. Re-check it in Settings → API keys.";
  } else if (status && status >= 500) {
    message = "The model provider returned a server error. Try this run again.";
  } else if (status && status >= 400) {
    message = `Provider rejected the request (${status}).`;
  } else {
    // Generic — don't leak stack traces or paths; cap length.
    message = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
  }
  return { status, message };
}

function byokErrorResponse(error: GetApiKeyError): Response {
  let message: string;
  switch (error.kind) {
    case "no-provider":
      message =
        "This project has no LLM provider set. Open it and finish setup before starting a run.";
      break;
    case "no-key":
      message = `Add an ${error.provider === "openai" ? "OpenAI" : "Anthropic"} API key in Settings → API keys before starting a run.`;
      break;
    case "decrypt-failed":
      message =
        "Stored API key couldn't be decrypted. Re-paste your key in Settings → API keys.";
      break;
    case "db-error":
      // Don't echo the raw Postgres/supabase-js error message —
      // it can include schema details, constraint names, and
      // sometimes values. Log it for operators; return a generic
      // string to the client.
      console.error("[chat] byok db lookup failed", error.message);
      message = "Could not look up your API key. Try again in a moment.";
      break;
  }
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    return await handlePost(request, ctx);
  } catch (err) {
    // requireUserWithDisclaimer / requireProjectById throw Response
    // objects directly — pass those through (don't redact the 403
    // / 404 messages, they're already client-safe).
    if (err instanceof Response) return err;

    const message = err instanceof Error ? err.message : String(err);
    console.error("[chat] unhandled", {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    // Don't surface internal exception messages to clients —
    // they can leak schema, constraint names, internal paths, etc.
    return new Response(JSON.stringify({ error: "Internal error." }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

async function handlePost(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  // Disclaimer gate before any cost-affecting work. requireProjectById
  // verifies project ownership (RLS-scoped read) but doesn't check
  // disclaimer state; requireUserWithDisclaimer does. Both run cheap
  // (one session probe shared via React.cache, plus one user-row
  // lookup) — safe to compose.
  await requireUserWithDisclaimer();
  const { user, project } = await requireProjectById(id);

  if (project.status !== "reviewing" && project.status !== "negotiating") {
    return new Response(null, { status: 204 });
  }

  // Per-user rate limit. Caps the most expensive endpoint in the app:
  // each run is a 5-minute Function + dozens of LLM calls. Burst cap
  // catches obvious abuse (rapid-fire POSTs); daily cap covers a slow
  // drip that adds up to a real bill.
  const verdict = await checkRateLimit({ userId: user.id, bucket: "chat" });
  if (!verdict.allowed) {
    console.warn(
      `[chat/rate-limit] denied user=${user.id.slice(0, 8)} bucket=chat retry_after=${verdict.retryAfterSec}s`,
    );
    return rateLimitResponse(verdict);
  }

  // BYOK: look up the project's snapshotted provider + the owner's
  // stored key for it. Decrypted plaintext lives only in this
  // function's scope and is handed to the resolved LanguageModel.
  // Dev override: if the user has no stored key AND DEV_AUTH_BYPASS
  // is set, byok falls back to env keys (NODE_ENV-guarded).
  const projectProvider = project.provider as Provider | null;
  const byokResult = await getApiKeyForProject({
    ownerId: project.owner_id,
    provider: projectProvider,
  });
  if (!byokResult.ok) {
    return byokErrorResponse(byokResult.error);
  }
  // projectProvider must be non-null here — getApiKeyForProject would
  // have returned a "no-provider" error otherwise. The type narrows
  // via the ok-result branch but TS can't see that linkage, so we
  // assert below.
  if (!projectProvider) {
    throw new Error("unreachable: BYOK ok but provider is null");
  }
  const llmCreds = { provider: projectProvider, apiKey: byokResult.apiKey };

  // Body is irrelevant — the client only POSTs once ("Start") to
  // open the stream. State of truth is the DB.
  await request.json().catch(() => ({}));

  const admin = createAdminClient();

  // Atomic single-run claim. Two concurrent POSTs both passed the
  // status check above (`reviewing`/`negotiating` is set well before
  // either starts), so without serialization both would race the
  // read-then-write inside `persistReviewIssues` and each insert up
  // to `max_issues` open rows, doubling the cap.
  //
  // The conditional UPDATE either takes the claim (column was null,
  // OR the previous claim is stale and the prior owner is presumed
  // crashed) or returns 0 rows so we bail with 204. PostgreSQL
  // serializes the row update under MVCC, so exactly one concurrent
  // POST wins.
  //
  // Stale threshold = run cap + slack. `maxDuration` is 300s, so any
  // claim older than 6 minutes belongs to a dead process and is
  // safe to steal. Without this, a Vercel timeout / OOM / deploy
  // mid-stream would brick the project until manual DB cleanup.
  const STALE_CLAIM_MS = 6 * 60 * 1000;
  const claimNow = new Date();
  const staleBefore = new Date(claimNow.getTime() - STALE_CLAIM_MS);
  const claim = await admin
    .from("projects")
    .update({ run_started_at: claimNow.toISOString() })
    .eq("id", project.id)
    .or(
      `run_started_at.is.null,run_started_at.lt.${staleBefore.toISOString()}`,
    )
    .select("id, run_started_at");
  if (claim.error) throw claim.error;
  if (!claim.data || claim.data.length === 0) {
    console.warn(
      `[chat] duplicate POST refused — run already in flight for project=${project.id.slice(0, 8)}`,
    );
    return new Response(null, { status: 204 });
  }
  console.log(
    `[chat/claim] acquired project=${project.id.slice(0, 8)} at=${claimNow.toISOString()}`,
  );

  // Idempotent release. Called from execute's finally, onFinish, the
  // loadReviewContext error path, AND the post-claim try/catch
  // around handlePost — every exit must clear the claim. The flag
  // guarantees we only issue one UPDATE no matter how many paths
  // race to release.
  let claimReleased = false;
  const releaseRunClaim = async () => {
    if (claimReleased) return;
    claimReleased = true;
    const upd = await admin
      .from("projects")
      .update({ run_started_at: null })
      .eq("id", project.id);
    if (upd.error) {
      console.warn("[chat] release run claim failed", upd.error);
    } else {
      console.log(
        `[chat/claim] released project=${project.id.slice(0, 8)} at=${new Date().toISOString()}`,
      );
    }
  };

  // Issues that the run flipped to `in_negotiation` but didn't carry
  // to a terminal status (agreed / impasse / unresolved / deferred)
  // before the run ended — most commonly because the stream was
  // aborted mid-loop. Without this, those issues stay "running"
  // forever and the UI shows a stale negotiation indicator.
  //
  // Idempotent: re-running the UPDATE on already-resolved issues is
  // a no-op thanks to the `status = 'in_negotiation'` filter.
  const resetStuckIssues = async () => {
    const upd = await admin
      .from("issues")
      .update({ status: "open" })
      .eq("project_id", project.id)
      .eq("status", "in_negotiation");
    if (upd.error) {
      console.warn("[chat] reset stuck issues failed", upd.error);
    }
  };

  try {
  const review = await loadReviewContext(project);
  if ("error" in review) {
    await releaseRunClaim();
    return new Response(JSON.stringify({ error: review.error }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  // F6 (plan 08): we own the message id; emit one `start` ourselves
  // and pass `sendStart: false` on every per-turn streamText.
  const messageId = crypto.randomUUID();
  const turnStartIso = new Date().toISOString();

  // Accumulated state across the run. tokenAccumulator is flushed to
  // `projects.run_usage` after every model call so the header chip
  // (calls · tokens · cost) updates live during a negotiation.
  const argumentHistoryByIssue = new Map<string, NegotiationTurn[]>();
  const tokenAccumulator: TokenAccumulator = {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedInputTokens: 0,
    callCount: 0,
    cost: 0,
    // Set of distinct model ids hit during this persisted message.
    // Stamped into `MessageMetadata.modelsUsed` at onFinish so the UI
    // (and Langfuse cross-checks) can render which model produced
    // each turn without recomputing from per-turn usage.
    models: new Set<string>(),
  };
  // Snapshot the project's prior run_usage at run start. Per-turn
  // writes compose `baseline + accumulator` so they never compound
  // across multiple updates (the previous bumpRunUsage approach
  // read-modified-wrote and double-counted under repeated flushes).
  const usageBaseline = readUsageBaseline(project);
  const persistUsage = async () => {
    const upd = await admin
      .from("projects")
      .update({
        run_usage: composeUsage(usageBaseline, tokenAccumulator),
      })
      .eq("id", project.id);
    if (upd.error) {
      console.warn("[chat/usage] persist failed", upd.error);
    }
  };

  const stream = createUIMessageStream<WargameUIMessage>({
    execute: async ({ writer }) => {
      try {
      writer.write({ type: "start", messageId });

      // -- Phase 1: reviews ----------------------------------------------
      const pending = await pendingReviewSides(admin, project);
      for (const side of pending) {
        if (request.signal.aborted) return;
        const turnId = `turn-review-${side}`;
        const startedAt = Date.now();
        writer.write({
          type: "data-turn",
          id: turnId, // F4: unique id per turn
          data: { kind: "review", side, startedAt },
        });
        await runReviewTurn({
          writer,
          project,
          side,
          review,
          admin,
          tokenAccumulator,
          persistUsage,
          signal: request.signal,
          llmCreds,
        });
        // R3: re-emit same id to fill in completedAt — data-part
        // reconciliation overwrites the data field in place.
        writer.write({
          type: "data-turn",
          id: turnId,
          data: { kind: "review", side, startedAt, completedAt: Date.now() },
        });
      }
      if (project.status === "reviewing") {
        console.log(
          `[chat/status] reviewing → negotiating project=${project.id.slice(0, 8)} @ ${new Date().toISOString()}`,
        );
        const upd = await admin
          .from("projects")
          .update({ status: "negotiating" })
          .eq("id", project.id);
        if (upd.error) {
          console.warn(
            "[chat/status] negotiating update failed",
            upd.error,
          );
        }
      }

      // -- Phase 2: arguments --------------------------------------------
      const { data: issues = [] } = await admin
        .from("issues")
        .select("*")
        .eq("project_id", project.id)
        .order("severity", { ascending: true })
        .order("created_at", { ascending: true });
      const activeIssues = (issues ?? [])
        .filter((i) => i.status === "open" || i.status === "in_negotiation")
        .sort(
          (a, b) =>
            SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
            a.created_at.localeCompare(b.created_at),
        );

      for (const issue of activeIssues) {
        if (request.signal.aborted) return;
        argumentHistoryByIssue.set(issue.id, []);
        // Mark the issue as in-negotiation so the status indicator
        // can show its title alongside the run progress. Guarded with
        // `.eq("status","open")` so we never overwrite a terminal
        // status (agreed / impasse / unresolved / deferred).
        await admin
          .from("issues")
          .update({ status: "in_negotiation" })
          .eq("id", issue.id)
          .eq("status", "open");
        const totalTurns = project.max_turns_per_issue * 2;
        let resolved = false;
        let turnsUsed = 0;
        // Supervisor's last gap observation, threaded back to the
        // NEXT opener turn as a neutral note about where they are.
        let observerNote: string | undefined;
        for (let t = 0; t < totalTurns; t++) {
          if (request.signal.aborted) return;
          const side: "blue" | "red" = pickSide(t, issue);
          const turnId = `turn-arg-${issue.id}-${t}`;
          const startedAt = Date.now();
          writer.write({
            type: "data-turn",
            id: turnId,
            data: { kind: "argument", side, issueId: issue.id, startedAt },
          });
          const turnText = await runArgumentTurn({
            writer,
            project,
            issue,
            side,
            review,
            history: argumentHistoryByIssue.get(issue.id) ?? [],
            tokenAccumulator,
            persistUsage,
            signal: request.signal,
            turnNumber: t + 1,
            totalTurns,
            observerNote,
            llmCreds,
          });
          // R3: reconcile with completedAt.
          writer.write({
            type: "data-turn",
            id: turnId,
            data: {
              kind: "argument",
              side,
              issueId: issue.id,
              startedAt,
              completedAt: Date.now(),
            },
          });
          argumentHistoryByIssue.get(issue.id)?.push({ side, text: turnText });
          turnsUsed = t + 1;

          // Silent supervisor: after each responder turn (odd t, so
          // both sides have spoken an equal number of times),
          // classify the dialogue. The agents don't see this; it's a
          // separate cheap-tier classifier that decides whether to
          // break out of the per-issue loop early.
          const isResponderTurn = t % 2 === 1;
          const isLastTurn = t === totalTurns - 1;
          if (isResponderTurn && !isLastTurn) {
            try {
              const {
                verdict,
                modelId: supervisorModelId,
                usage: supervisorUsage,
              } = await runSupervisor({
                ctx: {
                  review,
                  issue: {
                    title: issue.title,
                    summary: issue.summary,
                    severity: issue.severity,
                    raisedBy: issue.raised_by === "blue" ? "blue" : "red",
                  },
                  history: argumentHistoryByIssue.get(issue.id) ?? [],
                },
                signal: request.signal,
                llmCreds,
              });
              // Roll the supervisor call into run_usage so the chip
              // reflects real cost (the supervisor runs after every
              // responder turn and is a non-trivial fraction of a run).
              accumulate(tokenAccumulator, supervisorUsage, supervisorModelId);
              await persistUsage();
              if (verdict.converged && verdict.brief) {
                const placeholders = (verdict.placeholders ?? []).filter(
                  (p): p is NonNullable<typeof verdict.placeholders>[number] =>
                    p != null,
                );
                const hasPlaceholders = placeholders.length > 0;
                // Normalize each placeholder: drop the nullable wrappers
                // from the schema and stash positions as plain strings.
                const normalizedPlaceholders = placeholders.map((p) => ({
                  key: p.key,
                  description: p.description,
                  bluePosition: p.bluePosition ?? undefined,
                  redPosition: p.redPosition ?? undefined,
                }));
                writer.write({
                  type: "data-resolution",
                  id: `resolution-${issue.id}`,
                  data: {
                    issueId: issue.id,
                    outcome: hasPlaceholders ? "pending-input" : "converged",
                    turnsUsed,
                    brief: verdict.brief,
                    placeholders: hasPlaceholders
                      ? normalizedPlaceholders
                      : undefined,
                    reason: verdict.reason,
                  },
                });
                // Flip the issue row. Status stays "agreed" so the
                // existing UI counts both clean and pending-input as
                // resolved; the `resolution.kind` distinguishes them
                // for downstream (project stats, drafter, memo).
                const upd = await admin
                  .from("issues")
                  .update({
                    status: "agreed",
                    resolution: {
                      kind: hasPlaceholders
                        ? "agreed_with_placeholders"
                        : "agreed",
                      brief: verdict.brief,
                      placeholders: hasPlaceholders
                        ? normalizedPlaceholders
                        : undefined,
                      reason: verdict.reason,
                      turnsUsed,
                    },
                  })
                  .eq("id", issue.id);
                if (upd.error) {
                  console.warn(
                    "[chat/status] agreed update failed",
                    upd.error,
                  );
                }
                resolved = true;
                break;
              }
              // Not converged: thread the supervisor's gap reason
              // into the next opener's user prompt as an observer
              // note. Helps the agents engage with the named gap
              // rather than restating their openings.
              observerNote = verdict.reason;
            } catch (err) {
              // Supervisor failure is non-fatal — fall through and
              // let the per-issue cap act as the backstop.
              console.warn(
                "[chat] supervisor failed; continuing",
                err instanceof Error ? err.message : err,
              );
            }
          }
        }
        if (!resolved) {
          // P5: preserve the supervisor's last gap observation as the
          // cap-hit reason. By the time we get here, `observerNote`
          // holds the most recent supervisor's one-sentence summary
          // of why they couldn't close — much more useful to the user
          // than a generic "cap reached" string. Fall back to the
          // generic only if the supervisor never ran (shouldn't
          // happen under default settings, but defensive).
          const reason =
            observerNote ?? "Per-issue turn cap reached without convergence.";
          writer.write({
            type: "data-resolution",
            id: `resolution-${issue.id}`,
            data: {
              issueId: issue.id,
              outcome: "cap-hit",
              turnsUsed,
              reason,
            },
          });
          const upd = await admin
            .from("issues")
            .update({
              status: "unresolved",
              resolution: {
                kind: "unresolved",
                reason,
                turnsUsed,
              },
            })
            .eq("id", issue.id);
          if (upd.error) {
            console.warn(
              "[chat/status] unresolved update failed",
              upd.error,
            );
          }
        }
      }

      // -- Phase 3: drafting -------------------------------------------
      // After every issue's argument loop has settled, run the neutral
      // Drafter over the agreed briefs (clean + with-placeholders) and
      // produce a single revised contract via `submit_revised_draft`.
      // The downstream redline compile (plan 08 D3) diffs the revised
      // markdown against the original and assembles the tracked-change
      // .docx.
      if (!request.signal.aborted) {
        await runDraftingPhase({
          writer,
          project,
          review,
          admin,
          tokenAccumulator,
          persistUsage,
          signal: request.signal,
          llmCreds,
        });
      }

      // -- Phase 4: memo -----------------------------------------------
      // Fires whenever unresolved + deferred > 0, independent of
      // whether the Drafter fired. Produces a downloadable .docx memo.
      if (!request.signal.aborted) {
        await runMemoPhase({
          writer,
          project,
          review,
          admin,
          argumentHistoryByIssue,
          tokenAccumulator,
          persistUsage,
          signal: request.signal,
          llmCreds,
        });
      }

      console.log(
        `[chat/status] negotiating → complete project=${project.id.slice(0, 8)} @ ${new Date().toISOString()}`,
      );
      const completeUpd = await admin
        .from("projects")
        .update({
          status: "complete",
          completed_at: new Date().toISOString(),
        })
        .eq("id", project.id);
      if (completeUpd.error) {
        console.warn(
          "[chat/status] complete update failed",
          completeUpd.error,
        );
      }
      } catch (err) {
        // The two end-of-run phases (drafting, memo) catch their own
        // errors and emit `data-phase-error`. Anything that reaches
        // here is unexpected — capture it, log it, and surface a
        // generic error part so the run doesn't vanish silently.
        if (!request.signal.aborted) {
          console.error("[chat/execute] unhandled in stream", err);
          Sentry.captureException(err, {
            tags: { phase: "execute", projectId: project.id },
          });
          try {
            const { status, message } = extractPhaseError(err);
            writer.write({
              type: "data-phase-error",
              id: "execute-error",
              data: { phase: "memo", message, status, at: Date.now() },
            });
          } catch {
            // Writer may already be closed. Sentry has it.
          }
        }
      } finally {
        // Belt-and-braces release. `onFinish` will also fire in the
        // happy path and on abort, but if `execute` throws before
        // either, this is what unsticks the project for the next run.
        await releaseRunClaim();
        await resetStuckIssues();
      }
    },
    onFinish: async ({ responseMessage, isAborted }) => {
      // Always release the run claim, whether the stream completed
      // naturally or was aborted. Without this a cancelled run would
      // leave `run_started_at` set forever, blocking every future
      // POST with the "duplicate" guard.
      await releaseRunClaim();
      if (isAborted) {
        // Reset any issue the run had flipped to `in_negotiation`
        // back to `open` so the next attempt starts from a clean
        // state and the UI doesn't show a phantom "negotiating".
        await resetStuckIssues();
        return;
      }
      // Guard against persisting an empty assistant row. If a stream
      // opens and closes without emitting any parts (observed when a
      // duplicate POST races the original — see RCA 2026-05-20), the
      // route was happily writing `status=complete` with `parts=[]`.
      // That row then poisons the UI: `transcript-shell` picks the
      // *last* assistant row to render, so an empty trailing row
      // blanks all three columns even though the real transcript is
      // safely persisted in the prior row.
      if (responseMessage.parts.length === 0) {
        console.warn("[chat] skipping empty-parts persistence", {
          messageId: responseMessage.id,
          projectId: project.id,
        });
        await persistUsage();
        await langfuseSpanProcessor.forceFlush();
        return;
      }
      const completedIso = new Date().toISOString();
      // F1: responseMessage is the single accumulated UIMessage.
      const persisted: WargameUIMessage = {
        id: responseMessage.id,
        role: "assistant",
        metadata: {
          agent: "system",
          dbRole: "argument",
          issueId: null,
          createdAt: Date.parse(turnStartIso),
          completedAt: Date.parse(completedIso),
          modelsUsed:
            tokenAccumulator.models.size > 0
              ? [...tokenAccumulator.models].sort()
              : undefined,
        },
        parts: responseMessage.parts as WargameUIMessage["parts"],
      };
      const insert = await admin.from("messages").insert({
        id: responseMessage.id,
        project_id: project.id,
        issue_id: null,
        status: "complete",
        message: persisted as unknown as Tables<"messages">["message"],
      });
      if (insert.error) {
        console.error("[chat] message insert failed", insert.error);
      }
      await persistUsage();
      await langfuseSpanProcessor.forceFlush();
    },
  });

  return createUIMessageStreamResponse({ stream });
  } catch (err) {
    // Synchronous-ish setup error after the claim was taken (e.g.,
    // stream construction throws, or anything between the claim and
    // the return statement). The stream's own lifecycle never
    // started, so execute.finally / onFinish won't fire — release
    // here or the project stays claimed until TTL expiry. Same goes
    // for any issue we'd already flipped to in_negotiation before
    // the throw (rare on the setup path, but cheap to be safe).
    await releaseRunClaim();
    await resetStuckIssues();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Per-turn helpers
// ---------------------------------------------------------------------------

async function runReviewTurn(args: {
  writer: import("ai").UIMessageStreamWriter<WargameUIMessage>;
  project: Project;
  side: "blue" | "red";
  review: ReviewContext;
  admin: ReturnType<typeof createAdminClient>;
  tokenAccumulator: TokenAccumulator;
  persistUsage: () => Promise<void>;
  signal: AbortSignal;
  llmCreds: { provider: Provider; apiKey: string };
}) {
  const {
    writer,
    project,
    side,
    review,
    admin,
    tokenAccumulator,
    persistUsage,
    signal,
    llmCreds,
  } = args;
  const { model, modelId } = resolveModelForTier({
    tier: "baseline",
    provider: llmCreds.provider,
    apiKey: llmCreds.apiKey,
  });
  const system = side === "blue" ? BLUE_SYSTEM_PROMPT : RED_SYSTEM_PROMPT;
  const promptParts =
    side === "blue"
      ? buildBlueUserPromptParts(review)
      : buildRedUserPromptParts(review);

  const result = propagateAttributes(
    { sessionId: project.id, traceName: `negotiation-${project.id}` },
    () =>
      streamText({
        model,
        system,
        messages: [cachedUserMessage(promptParts)],
        tools: reviewTools,
        stopWhen: hasToolCall("submit_review"),
        abortSignal: signal,
        providerOptions: {
          openai: { reasoningEffort: "low", reasoningSummary: "auto" },
          anthropic: { thinking: { type: "enabled", budgetTokens: 4_000 } },
        },
        experimental_telemetry: {
          isEnabled: true,
          functionId: `review-${side}`,
          metadata: { projectId: project.id, side },
        },
      }),
  );

  // F5 (plan 08): sequential consumption, not writer.merge.
  // F6: sendStart/sendFinish false — our outer execute owns those.
  const reader = result
    .toUIMessageStream({
      sendStart: false,
      sendFinish: false,
      sendReasoning: true,
    })
    .getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    // The streamed chunks are typed for a generic UIMessage; we
    // know the actual shapes match our typed message (the tools come
    // from `reviewTools` / no-tools, and `data-*` parts only come
    // from our own `writer.write` calls above). Cast to satisfy the
    // narrowing writer signature.
    writer.write(value as Parameters<typeof writer.write>[0]);
  }

  // Persist Blue/Red's issues from the submit_review tool input.
  const toolCalls = await result.toolCalls;
  const submission = toolCalls.find(
    (t) => t.toolName === "submit_review",
  )?.input;
  const parsed =
    submission && reviewSchema.safeParse(submission).success
      ? reviewSchema.parse(submission)
      : null;
  if (parsed) {
    await persistReviewIssues(admin, project, side, parsed.issues);
  } else {
    console.warn(`[chat] review ${side}: missing/invalid submit_review`);
  }

  const usage = await result.totalUsage;
  accumulate(tokenAccumulator, usage, modelId);
  await persistUsage();
}

async function runArgumentTurn(args: {
  writer: import("ai").UIMessageStreamWriter<WargameUIMessage>;
  project: Project;
  issue: Issue;
  side: "blue" | "red";
  review: ReviewContext;
  history: NegotiationTurn[];
  tokenAccumulator: TokenAccumulator;
  persistUsage: () => Promise<void>;
  signal: AbortSignal;
  turnNumber: number;
  totalTurns: number;
  observerNote?: string;
  llmCreds: { provider: Provider; apiKey: string };
}): Promise<string> {
  const {
    writer,
    project,
    issue,
    side,
    review,
    history,
    tokenAccumulator,
    persistUsage,
    signal,
    turnNumber,
    totalTurns,
    observerNote,
    llmCreds,
  } = args;
  const { model, modelId } = resolveModelForTier({
    tier: "baseline",
    provider: llmCreds.provider,
    apiKey: llmCreds.apiKey,
  });
  const system =
    side === "blue" ? BLUE_NEGOTIATION_PROMPT : RED_NEGOTIATION_PROMPT;
  const ctx: NegotiationContext = {
    review,
    issue: {
      title: issue.title,
      summary: issue.summary,
      severity: issue.severity,
      raisedBy: issue.raised_by === "blue" ? "blue" : "red",
    },
    history,
  };
  const promptParts = buildNegotiationUserPromptParts(ctx, side, {
    turnNumber,
    totalTurns,
    observerNote,
  });

  const result = propagateAttributes(
    { sessionId: project.id, traceName: `negotiation-${project.id}` },
    () =>
      streamText({
        model,
        system,
        messages: [cachedUserMessage(promptParts)],
        // No tools. Prose only.
        abortSignal: signal,
        providerOptions: {
          openai: { reasoningEffort: "low", reasoningSummary: "auto" },
          anthropic: { thinking: { type: "enabled", budgetTokens: 4_000 } },
        },
        experimental_telemetry: {
          isEnabled: true,
          functionId: `argument-${side}`,
          metadata: { projectId: project.id, side, issueId: issue.id },
        },
      }),
  );

  const reader = result
    .toUIMessageStream({
      sendStart: false,
      sendFinish: false,
      sendReasoning: true,
    })
    .getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    // The streamed chunks are typed for a generic UIMessage; we
    // know the actual shapes match our typed message (the tools come
    // from `reviewTools` / no-tools, and `data-*` parts only come
    // from our own `writer.write` calls above). Cast to satisfy the
    // narrowing writer signature.
    writer.write(value as Parameters<typeof writer.write>[0]);
  }

  const text = await result.text;
  const usage = await result.totalUsage;
  accumulate(tokenAccumulator, usage, modelId);
  await persistUsage();
  return text;
}

// ---------------------------------------------------------------------------
// Drafting phase
// ---------------------------------------------------------------------------

async function runDraftingPhase(args: {
  writer: import("ai").UIMessageStreamWriter<WargameUIMessage>;
  project: Project;
  review: ReviewContext;
  admin: ReturnType<typeof createAdminClient>;
  tokenAccumulator: TokenAccumulator;
  persistUsage: () => Promise<void>;
  signal: AbortSignal;
  llmCreds: { provider: Provider; apiKey: string };
}): Promise<void> {
  const {
    writer,
    project,
    review,
    admin,
    tokenAccumulator,
    persistUsage,
    signal,
    llmCreds,
  } = args;

  // Pull every issue with its resolution payload so we can build
  // the agreed-briefs input + the unresolved leave-alone list.
  const { data: issues = [] } = await admin
    .from("issues")
    .select("*")
    .eq("project_id", project.id);

  const agreed: DrafterBrief[] = [];
  const unresolved: DrafterContext["unresolved"] = [];
  for (const i of issues ?? []) {
    const r = (i.resolution as Record<string, unknown> | null) ?? null;
    if (i.status === "agreed") {
      const brief =
        typeof r?.brief === "string" && r.brief.length > 0 ? r.brief : null;
      if (!brief) continue; // No usable brief — skip rather than corrupt the draft.
      const placeholders = Array.isArray(r?.placeholders)
        ? (r.placeholders as SupervisorPlaceholder[])
        : [];
      agreed.push({
        issueTitle: i.title,
        issueSummary: i.summary,
        severity: i.severity,
        brief,
        placeholders,
      });
    } else if (
      i.status === "impasse" ||
      i.status === "unresolved" ||
      i.status === "deferred"
    ) {
      unresolved.push({
        issueTitle: i.title,
        issueSummary: i.summary,
        status: i.status,
      });
    }
  }

  if (agreed.length === 0) {
    // Nothing agreed — no redline to produce. Skip silently rather
    // than write an empty drafting block.
    return;
  }

  // Load the source .docx and flatten to paragraph plain text. The
  // drafter consumes the paragraphs both as user-prompt context and
  // as the corpus for `find_in_document` reconnaissance. The bytes
  // get handed to `compileRedline` after the drafter submits.
  let original: Awaited<ReturnType<typeof loadOriginalDocx>>;
  try {
    original = await loadOriginalDocx(project.id);
  } catch (err) {
    console.warn("[chat/drafter] could not load source .docx", err);
    return;
  }

  const turnId = "turn-drafting";
  const startedAt = Date.now();
  writer.write({
    type: "data-turn",
    id: turnId,
    data: { kind: "drafting", side: "neutral", startedAt },
  });

  const { model, modelId } = resolveModelForTier({
    // Drafter has its own tier — Sonnet on Anthropic, mini on OpenAI.
    // Haiku 4.5 was emitting unmatchable `find` strings producing
    // 0-applied / N-errored redlines.
    tier: "drafter",
    provider: llmCreds.provider,
    apiKey: llmCreds.apiKey,
  });
  const ctx: DrafterContext = {
    review,
    paragraphs: original.paragraphs,
    agreed,
    unresolved,
  };
  const promptParts = buildDrafterPromptParts(ctx);
  const tools = createDrafterTools({ paragraphs: original.paragraphs });

  let totalUsagePromise: PromiseLike<LanguageModelUsage> | null = null;
  try {
    const result = propagateAttributes(
      { sessionId: project.id, traceName: `negotiation-${project.id}` },
      () =>
        streamText({
          model,
          system: DRAFTER_SYSTEM_PROMPT,
          messages: [cachedUserMessage(promptParts)],
          tools,
          stopWhen: hasToolCall("submit_edits"),
          abortSignal: signal,
          providerOptions: {
            openai: { reasoningEffort: "low", reasoningSummary: "auto" },
            anthropic: { thinking: { type: "enabled", budgetTokens: 4_000 } },
          },
          experimental_telemetry: {
            isEnabled: true,
            functionId: "drafter",
            metadata: { projectId: project.id },
          },
        }),
    );
    totalUsagePromise = result.totalUsage;

    const reader = result
      .toUIMessageStream({
        sendStart: false,
        sendFinish: false,
        sendReasoning: true,
      })
      .getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      writer.write(value as Parameters<typeof writer.write>[0]);
    }

    const toolCalls = await result.toolCalls;
    const submission = toolCalls.find(
      (t) => t.toolName === "submit_edits",
    )?.input;
    const parsed =
      submission && submitEditsSchema.safeParse(submission).success
        ? submitEditsSchema.parse(submission)
        : null;
    if (!parsed) {
      // No usable tool call — surface as a phase failure rather than
      // silently producing no redline.
      throw new Error("drafter did not return a submit_edits tool call");
    }
    console.log(
      `[chat/drafter] edits=${parsed.edits.length}; summary: ${parsed.summary.slice(0, 120)}`,
    );
    const compiled = await compileRedline({
      projectId: project.id,
      ownerId: project.owner_id,
      originalBytes: original.bytes,
      originalFilename: original.filename,
      edits: parsed.edits,
    });
    console.log(
      `[chat/drafter] redline compiled: ${compiled.changesApplied} applied, ${compiled.changesErrored} errored, key=${compiled.storageKey}`,
    );
    writer.write({
      type: "data-redline",
      id: "redline-final",
      data: {
        storageKey: compiled.storageKey,
        downloadFilename: compiled.downloadFilename,
        changesApplied: compiled.changesApplied,
        changesErrored: compiled.changesErrored,
      },
    });
  } catch (err) {
    if (signal.aborted) throw err;
    const { status, message } = extractPhaseError(err);
    console.error("[chat/drafter] phase failed", { status, message, err });
    Sentry.captureException(err, {
      tags: { phase: "drafting", projectId: project.id },
      extra: { status, modelId },
    });
    writer.write({
      type: "data-phase-error",
      id: "drafting-error",
      data: { phase: "drafting", message, status, at: Date.now() },
    });
  } finally {
    writer.write({
      type: "data-turn",
      id: turnId,
      data: {
        kind: "drafting",
        side: "neutral",
        startedAt,
        completedAt: Date.now(),
      },
    });
    if (totalUsagePromise) {
      try {
        const usage = await totalUsagePromise;
        accumulate(tokenAccumulator, usage, modelId);
        await persistUsage();
      } catch {
        // See memo phase: totalUsage can reject after a stream error.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Memo phase
// ---------------------------------------------------------------------------

async function runMemoPhase(args: {
  writer: import("ai").UIMessageStreamWriter<WargameUIMessage>;
  project: Project;
  review: ReviewContext;
  admin: ReturnType<typeof createAdminClient>;
  argumentHistoryByIssue: Map<string, NegotiationTurn[]>;
  tokenAccumulator: TokenAccumulator;
  persistUsage: () => Promise<void>;
  signal: AbortSignal;
  llmCreds: { provider: Provider; apiKey: string };
}): Promise<void> {
  const {
    writer,
    project,
    review,
    admin,
    argumentHistoryByIssue,
    tokenAccumulator,
    persistUsage,
    signal,
    llmCreds,
  } = args;

  // Pull every issue and partition for the handoff memo:
  //   - agreed     → AGREED CHANGES (with the supervisor's brief)
  //   - unresolved │
  //   - impasse    │→ OPEN ISSUES (parties discussed but didn't close)
  //   - deferred   → NOT YET DISCUSSED
  const { data: issues = [] } = await admin
    .from("issues")
    .select("*")
    .eq("project_id", project.id);

  const agreed: MemoAgreedInput[] = [];
  const openIssues: MemoOpenInput[] = [];
  const notYetDiscussed: MemoNotYetDiscussedInput[] = [];
  for (const i of issues ?? []) {
    const r = (i.resolution as Record<string, unknown> | null) ?? null;
    const raisedBy: "blue" | "red" = i.raised_by === "blue" ? "blue" : "red";
    if (i.status === "agreed") {
      const brief =
        typeof r?.brief === "string" && r.brief.length > 0 ? r.brief : null;
      if (!brief) continue; // No usable brief — skip rather than feed empty input.
      const placeholders = Array.isArray(r?.placeholders)
        ? (r.placeholders as SupervisorPlaceholder[]).map((p) => ({
            key: p.key,
            description: p.description,
          }))
        : undefined;
      agreed.push({
        issueTitle: i.title,
        issueSummary: i.summary,
        severity: i.severity,
        raisedBy,
        brief,
        placeholders,
      });
    } else if (i.status === "unresolved" || i.status === "impasse") {
      const history = argumentHistoryByIssue.get(i.id) ?? [];
      const lastBlue = [...history].reverse().find((t) => t.side === "blue");
      const lastRed = [...history].reverse().find((t) => t.side === "red");
      const gap =
        typeof r?.reason === "string" && r.reason.length > 0
          ? r.reason
          : typeof r?.impasseSummary === "string" && r.impasseSummary.length > 0
            ? r.impasseSummary
            : "The parties did not converge.";
      openIssues.push({
        issueTitle: i.title,
        issueSummary: i.summary,
        severity: i.severity,
        raisedBy,
        outcome: i.status === "impasse" ? "impasse" : "no-convergence",
        gap,
        bluePosition: truncate(lastBlue?.text ?? "", 1200),
        redPosition: truncate(lastRed?.text ?? "", 1200),
      });
    } else if (i.status === "deferred") {
      notYetDiscussed.push({
        issueTitle: i.title,
        issueSummary: i.summary,
        severity: i.severity,
        raisedBy,
      });
    }
  }

  if (openIssues.length === 0 && notYetDiscussed.length === 0) {
    // Nothing the deal team needs to pick up — a clean run is its own
    // handoff. Skip silently rather than producing a memo that is
    // just an agreed-list duplicate of the redline.
    return;
  }

  const turnId = "turn-memo";
  const startedAt = Date.now();
  writer.write({
    type: "data-turn",
    id: turnId,
    data: { kind: "memo", side: "neutral", startedAt },
  });

  const { model, modelId } = resolveModelForTier({
    tier: "baseline",
    provider: llmCreds.provider,
    apiKey: llmCreds.apiKey,
  });
  const ctx: MemoContext = { review, agreed, openIssues, notYetDiscussed };
  const promptPrefix = buildMemoPrompt(ctx);

  let totalUsagePromise: PromiseLike<LanguageModelUsage> | null = null;
  try {
    const result = propagateAttributes(
      { sessionId: project.id, traceName: `negotiation-${project.id}` },
      () =>
        // Memo runs once per project — no inter-call caching benefit,
        // so we skip the cacheControl breakpoint here and keep the
        // user message as a plain string.
        streamText({
          model,
          system: MEMO_SYSTEM_PROMPT,
          messages: [{ role: "user" as const, content: promptPrefix }],
          tools: memoTools,
          stopWhen: hasToolCall("submit_memo"),
          abortSignal: signal,
          providerOptions: {
            // Memo is a structured-output task with a strict
            // 2–3-sentence SUMMARY ceiling. Extended thinking
            // produced ~4k tokens of issue-by-issue analysis that
            // (a) added cost + latency for no quality gain and
            // (b) leaked into the UI as a wall of "reasoning"
            // text that swamped the actual memo body.
            openai: { reasoningEffort: "low", reasoningSummary: "auto" },
          },
          experimental_telemetry: {
            isEnabled: true,
            functionId: "memo",
            metadata: { projectId: project.id },
          },
        }),
    );
    totalUsagePromise = result.totalUsage;

    const reader = result
      .toUIMessageStream({
        sendStart: false,
        sendFinish: false,
        sendReasoning: true,
      })
      .getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      writer.write(value as Parameters<typeof writer.write>[0]);
    }

    const toolCalls = await result.toolCalls;
    const submission = toolCalls.find(
      (t) => t.toolName === "submit_memo",
    )?.input;
    const parsed =
      submission && submitMemoSchema.safeParse(submission).success
        ? submitMemoSchema.parse(submission)
        : null;
    if (!parsed) {
      // The model didn't call submit_memo. Treat as a phase failure so
      // the user sees something rather than a missing memo affordance.
      throw new Error("memo agent did not return a submit_memo tool call");
    }
    console.log(
      `[chat/memo] agreed=${parsed.agreed.length} open=${parsed.openIssues.length} notYetDiscussed=${parsed.notYetDiscussed.length} summary=${parsed.summary.slice(0, 120)}`,
    );
    const compiled = await compileMemo({
      projectId: project.id,
      ownerId: project.owner_id,
      contractTitle: review.contractTitle,
      memo: parsed,
      completedAtIso: new Date().toISOString(),
      blueParties: review.userSide.parties,
      redParties: review.counterpartySide.parties,
    });
    console.log(
      `[chat/memo] memo compiled: agreed=${compiled.agreedCount}, open=${compiled.openCount}, notYetDiscussed=${compiled.notYetDiscussedCount}, key=${compiled.storageKey}`,
    );
    writer.write({
      type: "data-memo",
      id: "memo-final",
      data: {
        storageKey: compiled.storageKey,
        downloadFilename: compiled.downloadFilename,
        agreedCount: compiled.agreedCount,
        openCount: compiled.openCount,
        notYetDiscussedCount: compiled.notYetDiscussedCount,
        summary: parsed.summary,
      },
    });
  } catch (err) {
    // The whole memo phase is best-effort: surface the failure to the
    // UI + Sentry but don't take down the run. The user still gets
    // their redline (if any) and the project flips to "complete".
    if (signal.aborted) throw err;
    const { status, message } = extractPhaseError(err);
    console.error("[chat/memo] phase failed", { status, message, err });
    Sentry.captureException(err, {
      tags: { phase: "memo", projectId: project.id },
      extra: { status, modelId },
    });
    writer.write({
      type: "data-phase-error",
      id: "memo-error",
      data: { phase: "memo", message, status, at: Date.now() },
    });
  } finally {
    // Always close the turn meta so the UI's "streaming" indicator
    // resolves. If `result` never got a chance to start, skip usage.
    writer.write({
      type: "data-turn",
      id: turnId,
      data: {
        kind: "memo",
        side: "neutral",
        startedAt,
        completedAt: Date.now(),
      },
    });
    if (totalUsagePromise) {
      try {
        const usage = await totalUsagePromise;
        accumulate(tokenAccumulator, usage, modelId);
        await persistUsage();
      } catch {
        // totalUsage can reject if the stream errored before any
        // usage was emitted. Cost reporting is non-critical.
      }
    }
  }
}

function truncate(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickSide(turnIndex: number, issue: Issue): "blue" | "red" {
  // The side that did NOT raise the issue opens. After that, alternate.
  const opener: "blue" | "red" = issue.raised_by === "red" ? "blue" : "red";
  return turnIndex % 2 === 0 ? opener : opener === "blue" ? "red" : "blue";
}

async function pendingReviewSides(
  admin: ReturnType<typeof createAdminClient>,
  project: Project,
): Promise<Array<"blue" | "red">> {
  const { data: rows = [] } = await admin
    .from("messages")
    .select("message")
    .eq("project_id", project.id);
  const reviewed = new Set<string>();
  for (const r of rows ?? []) {
    const ui = (r as { message: WargameUIMessage | null }).message;
    if (!ui) continue;
    // Also looks inside the parts of a one-per-run row.
    for (const p of ui.parts) {
      if (p.type === "data-turn" && p.data.kind === "review") {
        reviewed.add(p.data.side);
      }
    }
    // Legacy per-turn rows (plan 07): metadata identifies the turn.
    if (
      ui.metadata?.dbRole === "review" &&
      (ui.metadata.agent === "blue" || ui.metadata.agent === "red")
    ) {
      reviewed.add(ui.metadata.agent);
    }
  }
  // A party doesn't review the contract it drafted — it has no
  // gripes with its own work. Only the non-drafting party reviews.
  // When draft ownership is "neither" (or unknown), both review.
  //   ours   = blue drafted → only red reviews
  //   theirs = red drafted  → only blue reviews
  //   neither = unclear/co-drafted → both review
  const reviewerByOwnership: Record<string, Array<"blue" | "red">> = {
    ours: ["red"],
    theirs: ["blue"],
    neither: ["blue", "red"],
  };
  const eligible: Array<"blue" | "red"> =
    reviewerByOwnership[project.draft_ownership ?? "neither"] ?? ["blue", "red"];
  return eligible.filter((s) => !reviewed.has(s));
}

async function persistReviewIssues(
  admin: ReturnType<typeof createAdminClient>,
  project: Project,
  side: "blue" | "red",
  issues: ReviewIssue[],
) {
  const { data: existing = [] } = await admin
    .from("issues")
    .select("id")
    .eq("project_id", project.id);
  const remaining = Math.max(
    0,
    project.max_issues - (existing?.length ?? 0),
  );
  const sorted = [...issues].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
  const accepted = sorted.slice(0, remaining);
  const overflow = sorted.slice(remaining);
  if (accepted.length > 0) {
    const ins = await admin.from("issues").insert(
      accepted.map((i) => ({
        project_id: project.id,
        raised_by: side,
        title: i.title,
        summary: i.summary,
        severity: i.severity,
        status: "open" as const,
      })),
    );
    if (ins.error) {
      console.error("[chat] issue insert failed", ins.error);
    }
  }
  if (overflow.length > 0) {
    const ins = await admin.from("issues").insert(
      overflow.map((i) => ({
        project_id: project.id,
        raised_by: side,
        title: i.title,
        summary: i.summary,
        severity: i.severity,
        status: "deferred" as const,
        resolution: { kind: "deferred", reason: "Per-run cap exceeded." },
      })),
    );
    if (ins.error) {
      console.error("[chat] overflow insert failed", ins.error);
    }
  }
}

async function loadReviewContext(
  project: Project,
): Promise<ReviewContext | { error: string }> {
  const admin = createAdminClient();
  const [{ data: parties = [] }, { data: answers = [] }, { data: fileRows = [] }] =
    await Promise.all([
      admin.from("project_parties").select("*").eq("project_id", project.id),
      admin.from("interview_answers").select("*").eq("project_id", project.id),
      admin
        .from("files")
        .select("name, markdown_content")
        .eq("project_id", project.id)
        .order("created_at", { ascending: true }),
    ]);

  if (!project.draft_ownership) {
    return { error: "Cannot run without draft_ownership; finish the interview." };
  }

  const usable = (fileRows ?? [])
    .filter((f) => (f.markdown_content ?? "").length > 0)
    .map((f) => ({ name: f.name, markdown: f.markdown_content ?? "" }));
  if (usable.length === 0) {
    return { error: "No converted file content. Re-upload the .docx files." };
  }

  const userParties: Array<{ name: string; role: string }> = [];
  const counterParties: Array<{ name: string; role: string }> = [];
  for (const p of parties ?? []) {
    if (!p.name && !p.role) continue;
    const entry = { name: p.name ?? "", role: p.role ?? "" };
    if (p.is_user_side === true) userParties.push(entry);
    else if (p.is_user_side === false) counterParties.push(entry);
  }
  const userAnswer =
    answers?.find((a) => a.question_key === "user_side_details")?.answer ?? "";
  const counterAnswer =
    answers?.find((a) => a.question_key === "counterparty_details")?.answer ??
    "";
  const contractMarkdown = usable
    .map((f) => `# ${f.name}\n\n${f.markdown}`)
    .join("\n\n---\n\n");

  return {
    contractTitle: project.name,
    contractMarkdown,
    draftOwnership: project.draft_ownership,
    userSide: { parties: userParties, details: userAnswer },
    counterpartySide: { parties: counterParties, details: counterAnswer },
  };
}

// ---------------------------------------------------------------------------
// Usage accounting — flushed to projects.run_usage after every model call so
// the header chip (calls · tokens · cost) updates live during a run.
// ---------------------------------------------------------------------------

type TokenAccumulator = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
  callCount: number;
  cost: number;
  models: Set<string>;
};

type UsageBaseline = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
  callCount: number;
  estimatedCostUsd: number;
};

function readUsageBaseline(project: Project): UsageBaseline {
  const r = (project.run_usage as Record<string, unknown> | null) ?? {};
  const num = (k: string) =>
    typeof r[k] === "number" ? (r[k] as number) : 0;
  return {
    inputTokens: num("inputTokens"),
    outputTokens: num("outputTokens"),
    reasoningTokens: num("reasoningTokens"),
    cachedInputTokens: num("cachedInputTokens"),
    callCount: num("callCount"),
    estimatedCostUsd: num("estimatedCostUsd"),
  };
}

function composeUsage(baseline: UsageBaseline, acc: TokenAccumulator) {
  return {
    inputTokens: baseline.inputTokens + acc.inputTokens,
    outputTokens: baseline.outputTokens + acc.outputTokens,
    reasoningTokens: baseline.reasoningTokens + acc.reasoningTokens,
    cachedInputTokens: baseline.cachedInputTokens + acc.cachedInputTokens,
    callCount: baseline.callCount + acc.callCount,
    estimatedCostUsd: baseline.estimatedCostUsd + acc.cost,
    updatedAt: Date.now(),
  };
}

function accumulate(
  acc: TokenAccumulator,
  usage: LanguageModelUsage | undefined,
  modelId: string,
) {
  const u = {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    reasoningTokens: usage?.reasoningTokens ?? 0,
    cachedInputTokens: usage?.cachedInputTokens ?? 0,
  };
  acc.inputTokens += u.inputTokens;
  acc.outputTokens += u.outputTokens;
  acc.reasoningTokens += u.reasoningTokens;
  acc.cachedInputTokens += u.cachedInputTokens;
  acc.callCount += 1;
  acc.cost += estimateCostUsd(modelId, u);
  acc.models.add(modelId);
}

/** Build a multi-part user message that splits the prompt at its
 *  stable/dynamic boundary, with an Anthropic prompt-cache
 *  breakpoint on the stable part. The two text parts concatenate
 *  to byte-identical content vs. the original flat string
 *  (verified by the prompt builders' own unit-equivalent test).
 *  OpenAI accepts multi-part text content and concatenates
 *  transparently — the `anthropic`-namespaced providerOptions are
 *  ignored on the OpenAI path, so this is a no-op there. */
function cachedUserMessage(parts: {
  stable: string;
  dynamic: string;
}): NonNullable<Parameters<typeof streamText>[0]["messages"]>[number] {
  return {
    role: "user" as const,
    content: [
      {
        type: "text" as const,
        text: parts.stable,
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral" } },
        },
      },
      { type: "text" as const, text: parts.dynamic },
    ],
  };
}

// Silence "unused" if TS warns; UIMessage is re-exported by the
// route's input/output indirectly.
type _UIMessageRef = UIMessage;
