"use client";

import {
  DraftViewer,
  type DraftViewerSource,
} from "@/components/draft-viewer/draft-viewer";
import { Button } from "@/components/ui/button";
import { getDevDrafterTestUrl } from "@/lib/actions/dev-drafter-test";
import { cn } from "@/lib/utils";
import { useMemo, useRef, useState } from "react";

const DEFAULT_BRIEFS = JSON.stringify(
  {
    contractTitle: "Master License Agreement",
    userParties: [{ name: "Customer", role: "Licensee" }],
    counterparties: [{ name: "Supplier", role: "Licensor" }],
    draftOwnership: "theirs",
    agreed: [
      {
        issueTitle: "Payment terms tightened from net-60 to net-30",
        issueSummary:
          "Customer's standard payment terms are net-30. Supplier's draft pushed net-60 as the validly-rendered-invoice payment window. The parties agreed to net-30.",
        severity: "high",
        brief:
          "Change the payment window for validly rendered Supplier invoices from sixty (60) days to thirty (30) days. Update both the numeric form and any spelled-out form. Preserve the good-faith dispute carve-out. No other Section 5 changes.",
        placeholders: [],
      },
    ],
    unresolved: [],
  },
  null,
  2,
);

interface RunResult {
  ok: boolean;
  storageKey: string;
  downloadFilename: string;
  drafterMs: number;
  applyMs: number;
  edits: Array<{
    find: string;
    replace: string;
    contextBefore: string;
    contextAfter: string;
    reason: string;
  }>;
  summary: string;
  findCalls: Array<{ query: string; matches: number; truncated: boolean }>;
  applied: number;
  errored: number;
  errors: Array<{ index: number; reason: string }>;
  redundantCount: number;
  redundant: Array<{ index: number; reason: string }>;
  paragraphs: number;
  promptChars: number;
  modelId: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
  };
  cost: number;
}

export function DrafterTestView() {
  const [briefs, setBriefs] = useState(DEFAULT_BRIEFS);
  const [docxName, setDocxName] = useState<string>("");
  const [docxBlob, setDocxBlob] = useState<Blob | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const viewerSource: DraftViewerSource | null = useMemo(() => {
    if (!result) return null;
    return {
      fileId: "redline",
      fileName: result.downloadFilename,
      versionId: result.storageKey,
      source: "output",
      versionNumber: 1,
      getUrl: (mode) =>
        getDevDrafterTestUrl({
          storageKey: result.storageKey,
          downloadFilename: result.downloadFilename,
          mode,
        }),
    };
  }, [result]);

  const onPickFile = (file: File | undefined) => {
    if (!file) return;
    setDocxName(file.name);
    setDocxBlob(file);
    setError(null);
  };

  const onRun = async () => {
    if (!docxBlob) {
      setError("Pick a .docx first.");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(briefs);
    } catch (err) {
      setError(
        `Briefs JSON parse failed: ${err instanceof Error ? err.message : err}`,
      );
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("docx", docxBlob, docxName || "uploaded.docx");
      form.append("briefs", JSON.stringify(parsed));
      form.append("filename", docxName || "uploaded.docx");
      const res = await fetch("/api/dev/drafter-test", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as RunResult;
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-6">
      <header className="flex shrink-0 flex-col gap-1">
        <h1 className="text-xl font-semibold">Drafter sandbox</h1>
        <p className="text-sm text-muted-foreground">
          Upload a .docx, paste briefs JSON, run the drafter in
          isolation. Dev-only.
        </p>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        {/* Left column: inputs + run + results */}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Source .docx</span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => fileInputRef.current?.click()}
              >
                Choose file
              </Button>
              <span className="truncate text-sm text-muted-foreground">
                {docxName || "(none)"}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={(e) => onPickFile(e.target.files?.[0])}
              />
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <label htmlFor="briefs-json" className="text-sm font-medium">
              Briefs (JSON)
            </label>
            <textarea
              id="briefs-json"
              value={briefs}
              onChange={(e) => setBriefs(e.target.value)}
              spellCheck={false}
              className={cn(
                "min-h-64 flex-1 resize-y rounded-md border border-border bg-background px-3 py-2",
                "font-mono text-xs leading-relaxed",
                "focus:outline-none focus-visible:ring-1 focus-visible:ring-accent",
              )}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={onRun} disabled={running || !docxBlob}>
              {running ? "Running…" : "Run drafter"}
            </Button>
            {error ? (
              <span className="text-sm text-destructive">{error}</span>
            ) : null}
          </div>

          {result ? <ResultPanel result={result} /> : null}
        </div>

        {/* Right column: in-place viewer for the redline */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border">
          {viewerSource ? (
            <DraftViewer sources={[viewerSource]} className="flex-1" />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              Redline appears here after the run.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultPanel({ result }: { result: RunResult }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-border p-3 font-mono text-xs">
        <Stat label="model" value={result.modelId} />
        <Stat
          label="drafter"
          value={`${(result.drafterMs / 1000).toFixed(1)} s`}
        />
        <Stat label="paragraphs" value={String(result.paragraphs)} />
        <Stat
          label="apply"
          value={`${(result.applyMs / 1000).toFixed(2)} s`}
        />
        <Stat
          label="tokens"
          value={`in ${result.usage.inputTokens} · out ${result.usage.outputTokens}`}
        />
        <Stat label="cost" value={`$${result.cost.toFixed(4)}`} />
        <Stat
          label="applied"
          value={
            <span
              className={cn(
                result.errored === 0 ? "text-team-green" : undefined,
              )}
            >
              {result.applied}
            </span>
          }
        />
        <Stat
          label="errored"
          value={
            <span
              className={cn(
                result.errored > 0 ? "text-team-red" : undefined,
              )}
            >
              {result.errored}
            </span>
          }
        />
        <Stat
          label="redundant"
          value={
            <span
              className={cn(
                result.redundantCount > 0
                  ? "text-muted-foreground"
                  : undefined,
              )}
              title="Edits whose range was fully covered by another applied edit. No coverage loss; the content was already changed."
            >
              {result.redundantCount}
            </span>
          }
        />
      </div>

      {result.summary ? (
        <div className="flex flex-col gap-1">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Summary
          </h2>
          <p className="whitespace-pre-wrap leading-relaxed">
            {result.summary}
          </p>
        </div>
      ) : null}

      {result.findCalls.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            find_in_document calls
          </h2>
          <ul className="flex flex-col gap-1 font-mono text-xs">
            {result.findCalls.map((c, i) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: dev tooling; list is append-only, never reordered.
                key={i}
              >
                {JSON.stringify(c.query)} → {c.matches} match
                {c.matches === 1 ? "" : "es"}
                {c.truncated ? " (truncated)" : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Edits ({result.edits.length})
        </h2>
        <ol className="flex flex-col gap-2">
          {result.edits.map((e, i) => {
            const errored = result.errors.some((err) => err.index === i);
            const redundant = result.redundant.some((r) => r.index === i);
            const statusLabel = errored
              ? "not applied"
              : redundant
                ? "redundant"
                : "applied";
            const statusColor = errored
              ? "text-destructive"
              : redundant
                ? "text-muted-foreground"
                : "text-team-green";
            return (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: dev tooling; list is append-only, never reordered.
                key={i}
                className={cn(
                  "rounded-md border border-border p-2 font-mono text-xs",
                  errored && "border-destructive/50 bg-destructive/5",
                  redundant && "opacity-60",
                )}
              >
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-muted-foreground">
                    #{i + 1} <span className={statusColor}>· {statusLabel}</span>
                  </span>
                  <span className="text-muted-foreground">{e.reason}</span>
                </div>
                <KV label="find" value={e.find} />
                <KV label="replace" value={e.replace} />
                <KV label="cbefore" value={e.contextBefore} muted />
                <KV label="cafter" value={e.contextAfter} muted />
                {errored ? (
                  <KV
                    label="error"
                    value={
                      result.errors.find((err) => err.index === i)?.reason ??
                      ""
                    }
                  />
                ) : null}
                {redundant ? (
                  <KV
                    label="note"
                    value={
                      result.redundant.find((r) => r.index === i)?.reason ?? ""
                    }
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function KV({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex gap-2 leading-snug">
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 flex-1 whitespace-pre-wrap break-words",
          muted ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {JSON.stringify(value)}
      </span>
    </div>
  );
}
