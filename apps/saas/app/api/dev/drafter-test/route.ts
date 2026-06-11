// Dev-only drafter sandbox.
//
// POST a .docx + a JSON briefs payload; the route runs the drafter
// against them, applies the emitted edits via applyTrackedEdits,
// uploads the result to Storage under a dev-prefix, and returns the
// stats + edits + storage key so the page can render a DraftViewer.
//
// Gated on NODE_ENV !== "production". Authenticated user (via the
// normal session) but no project required.

import "server-only";
import { requireUser } from "@/lib/auth-session";
import { uploadObject } from "@/lib/storage";
import {
  type DrafterContext,
  DRAFTER_SYSTEM_PROMPT,
  buildDrafterPrompt,
  createDrafterTools,
  estimateCostUsd,
  resolveModelForTier,
  submitEditsSchema,
} from "@wargame-esq/agents";
import {
  applyTrackedEdits,
  flattenDocument,
} from "@wargame-esq/docx-redlines";
import { hasToolCall, streamText } from "ai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

interface BriefsPayload {
  contractTitle: string;
  userParties?: Array<{ name: string; role?: string }>;
  counterparties?: Array<{ name: string; role?: string }>;
  draftOwnership?: "ours" | "theirs" | "neither";
  agreed: DrafterContext["agreed"];
  unresolved?: DrafterContext["unresolved"];
}

interface FindCall {
  query: string;
  matches: number;
  truncated: boolean;
}

export async function POST(request: Request) {
  // Two-condition gate, matching the rest of the codebase's dev
  // surfaces (apps/saas/lib/byok.ts devFallbackKey,
  // /api/dev/sign-in/route.ts). NODE_ENV alone is insufficient —
  // Vercel Preview deploys run with NODE_ENV !== "production" and
  // are reachable by anyone who can sign in. Without the
  // DEV_AUTH_BYPASS leg this becomes a free LLM gateway on every
  // preview URL.
  if (
    process.env.NODE_ENV === "production" ||
    process.env.DEV_AUTH_BYPASS !== "1"
  ) {
    return NextResponse.json(
      { error: "dev-only endpoint" },
      { status: 404 },
    );
  }
  const user = await requireUser();

  const form = await request.formData();
  const docxBlob = form.get("docx");
  const briefsRaw = form.get("briefs");
  const filename =
    (form.get("filename") as string | null) ?? "uploaded.docx";

  if (!(docxBlob instanceof Blob)) {
    return NextResponse.json(
      { error: "docx blob missing" },
      { status: 400 },
    );
  }
  if (typeof briefsRaw !== "string") {
    return NextResponse.json(
      { error: "briefs JSON missing" },
      { status: 400 },
    );
  }

  let briefs: BriefsPayload;
  try {
    briefs = JSON.parse(briefsRaw) as BriefsPayload;
  } catch (err) {
    return NextResponse.json(
      { error: `briefs JSON parse failed: ${err instanceof Error ? err.message : err}` },
      { status: 400 },
    );
  }
  if (!Array.isArray(briefs.agreed) || briefs.agreed.length === 0) {
    return NextResponse.json(
      { error: "briefs.agreed[] is required and must be non-empty" },
      { status: 400 },
    );
  }

  const bytes = Buffer.from(await docxBlob.arrayBuffer());
  const { paragraphs } = await flattenDocument(bytes);
  // Mirror what the CLI prints so dev-sandbox runs are comparable.
  const runId = crypto.randomUUID().slice(0, 8);
  const log = (msg: string) =>
    console.log(`[dev-drafter-test ${runId}] ${msg}`);
  log(
    `docx=${filename}  paras=${paragraphs.length}  agreed=${briefs.agreed.length}`,
  );

  const ctx: DrafterContext = {
    review: {
      contractTitle: briefs.contractTitle,
      contractMarkdown: "(not used — drafter consumes paragraphs)",
      draftOwnership: briefs.draftOwnership ?? "neither",
      userSide: {
        parties: (briefs.userParties ?? []).map((p) => ({
          name: p.name,
          role: p.role ?? "",
        })),
        details: "",
      },
      counterpartySide: {
        parties: (briefs.counterparties ?? []).map((p) => ({
          name: p.name,
          role: p.role ?? "",
        })),
        details: "",
      },
    },
    paragraphs,
    agreed: briefs.agreed,
    unresolved: briefs.unresolved ?? [],
  };

  const prompt = buildDrafterPrompt(ctx);
  const tools = createDrafterTools({ paragraphs });
  // Dev-only route — falls back to env keys via resolveModelForTier's
  // env path. Production callers must pass explicit BYOK creds.
  const { model, modelId } = resolveModelForTier({ tier: "baseline" });

  const t0 = Date.now();
  const result = streamText({
    model,
    system: DRAFTER_SYSTEM_PROMPT,
    messages: [{ role: "user" as const, content: prompt }],
    tools,
    stopWhen: hasToolCall("submit_edits"),
    providerOptions: {
      openai: { reasoningEffort: "low", reasoningSummary: "auto" },
    },
  });

  const findCalls: FindCall[] = [];
  // Track in-flight find_in_document calls by toolCallId so we can
  // pair the result with the query string.
  const pendingFinds = new Map<string, string>();
  for await (const chunk of result.fullStream) {
    if (chunk.type === "tool-call" && chunk.toolName === "find_in_document") {
      const input = chunk.input as { query?: string };
      pendingFinds.set(chunk.toolCallId, input?.query ?? "");
      log(`find_in_document(${JSON.stringify(input?.query ?? "")})`);
    }
    if (chunk.type === "tool-result" && chunk.toolName === "find_in_document") {
      const out = chunk.output as
        | { matches?: unknown[]; truncated?: boolean }
        | undefined;
      const query = pendingFinds.get(chunk.toolCallId) ?? "";
      pendingFinds.delete(chunk.toolCallId);
      const n = out?.matches?.length ?? 0;
      findCalls.push({
        query,
        matches: n,
        truncated: !!out?.truncated,
      });
      log(`  → ${n} match${n === 1 ? "" : "es"}${out?.truncated ? " (truncated)" : ""}`);
    }
  }

  const drafterMs = Date.now() - t0;

  const toolCalls = await result.toolCalls;
  const submit = toolCalls.find(
    (c: { toolName: string }) => c.toolName === "submit_edits",
  );
  if (!submit) {
    log(`drafter did not call submit_edits (wall=${drafterMs}ms)`);
    return NextResponse.json(
      { error: "drafter did not call submit_edits" },
      { status: 502 },
    );
  }
  const parsed = submitEditsSchema.parse(submit.input);
  log(
    `submit_edits: ${parsed.edits.length} edit${parsed.edits.length === 1 ? "" : "s"} · wall=${drafterMs}ms`,
  );
  log(`summary: ${parsed.summary.slice(0, 240)}${parsed.summary.length > 240 ? "…" : ""}`);
  parsed.edits.forEach((e, i) => {
    log(`  edit #${i + 1} reason=${JSON.stringify(e.reason)}`);
    log(`    find    : ${JSON.stringify(e.find.slice(0, 100))}`);
    log(`    replace : ${JSON.stringify(e.replace.slice(0, 100))}`);
  });

  const t1 = Date.now();
  const applied = await applyTrackedEdits({
    bytes,
    edits: parsed.edits,
    author: "Counsel",
    date: new Date().toISOString(),
  });
  const applyMs = Date.now() - t1;
  log(
    `applyTrackedEdits: applied=${applied.changes.length} errored=${applied.errors.length} redundant=${applied.redundant.length} · wall=${applyMs}ms`,
  );
  for (const e of applied.errors) log(`  err #${e.index}: ${e.reason}`);
  for (const e of applied.redundant) log(`  redundant #${e.index}: ${e.reason}`);

  // Upload the redline so the page's DraftViewer can fetch it via a
  // signed URL. Dev-only prefix; not part of any project's tree.
  const storageKey = `${user.id}/dev-drafter-test/${crypto.randomUUID()}.docx`;
  const baseName = filename.replace(/\.docx$/i, "");
  const downloadFilename = `${baseName}.redline.docx`;
  await uploadObject(
    storageKey,
    new Uint8Array(applied.bytes),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );

  const usage = await result.totalUsage;
  const cost = estimateCostUsd(modelId, {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    reasoningTokens: usage?.reasoningTokens ?? 0,
    cachedInputTokens: usage?.cachedInputTokens ?? 0,
  });

  return NextResponse.json({
    ok: true,
    storageKey,
    downloadFilename,
    drafterMs,
    applyMs,
    edits: parsed.edits,
    summary: parsed.summary,
    findCalls,
    applied: applied.changes.length,
    errored: applied.errors.length,
    errors: applied.errors,
    redundantCount: applied.redundant.length,
    redundant: applied.redundant,
    paragraphs: paragraphs.length,
    promptChars: prompt.length,
    modelId,
    usage: {
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      reasoningTokens: usage?.reasoningTokens ?? 0,
    },
    cost,
  });
}
