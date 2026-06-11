"use client";

// Whole-document viewer for the project's working draft.
//
// Renders the latest version per file as HTML using docx-preview,
// faithfully reproducing layout + native Word tracked changes
// (`<w:ins>` / `<w:del>`). For multi-file projects the user can flip
// between files via the tab strip in the panel header.
//
// We feed docx-preview a Blob fetched from a short-lived signed URL
// minted server-side. Rendering happens entirely client-side — no
// docx → html service to operate.

import { cn } from "@/lib/utils";
import { XIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Shimmer } from "../ai-elements/shimmer";

/** Result shape of a `getUrl` callback. Mirrors the server-action
 *  return convention used by `getDraftVersionUrl`, `getRedlineUrl`,
 *  and `getMemoUrl`. */
export type DraftViewerUrlResult = { url: string } | { error: string };

/** A renderable .docx source. The viewer is agnostic about which
 *  backend produced it — pass a `getUrl` callback that mints a
 *  fresh signed URL on demand. */
export interface DraftViewerSource {
  /** Stable identity for tab selection (working-draft uses fileId,
   *  PoC uses a synthetic key like "redline" or "memo"). */
  fileId: string;
  /** Tab label shown above the viewer. */
  fileName: string;
  /** Distinguishes one render of the same source from another so
   *  the renderer's effect can re-run cleanly on swap. */
  versionId: string;
  /** Header sub-label kind. `output` is the PoC bucket; the others
   *  preserve the working-draft semantics. */
  source: "upload" | "proposal" | "accepted" | "output";
  /** Display number in the header. PoC outputs always pass `1`. */
  versionNumber: number;
  /** Mints a fresh signed URL on demand. Called once per render. */
  getUrl: (mode: "view" | "download") => Promise<DraftViewerUrlResult>;
}

function sourceLabel(s: DraftViewerSource): string {
  if (s.source === "upload") return "Original";
  if (s.source === "accepted") return "Accepted draft";
  if (s.source === "output") return "Output";
  return "Proposed draft";
}

export function DraftViewer({
  sources,
  className,
  activeFileId: controlledFileId,
  onActiveFileIdChange,
  override,
  onClearOverride,
  onClose,
  closeLabel,
  renderHeader = true,
}: {
  sources: DraftViewerSource[];
  className?: string;
  /** Optional controlled active-file id. When provided, the parent drives
   *  tab selection (e.g. flipping to Draft mode for a specific file via
   *  a ProposalLink). When omitted, the viewer manages its own state. */
  activeFileId?: string | null;
  onActiveFileIdChange?: (fileId: string) => void;
  /** A specific version to render in place of the per-file pick.
   *  Used when a chat proposal link wants the viewer pinned to that
   *  turn's draft. */
  override?: DraftViewerSource;
  onClearOverride?: () => void;
  /** When provided, the header renders an XIcon close button on the
   *  far-right edge (across from the filename) that fires this. PoC
   *  passes a callback that flips back to debate mode. */
  onClose?: () => void;
  closeLabel?: string;
  /** When false, the viewer's built-in header bar (tabs + source
   *  label + close button) is not rendered. The caller is then
   *  expected to provide its own header above this viewer. Default
   *  true to preserve the working-draft viewer's behavior. */
  renderHeader?: boolean;
}) {
  const [internalFileId, setInternalFileId] = useState<string | null>(
    sources[0]?.fileId ?? null,
  );
  const activeFileId =
    controlledFileId !== undefined ? controlledFileId : internalFileId;
  const setActiveFileId = (id: string) => {
    if (controlledFileId === undefined) setInternalFileId(id);
    onActiveFileIdChange?.(id);
  };

  if (sources.length === 0) {
    return (
      <div
        className={cn(
          "flex h-full items-center justify-center text-muted-foreground",
          className,
        )}
      >
        No draft yet. Upload a .docx to start.
      </div>
    );
  }

  const fallback = sources.find((s) => s.fileId === activeFileId) ?? sources[0];
  const active = override ?? fallback;
  if (!active) return null;

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col border-4 border-foreground rounded-2xl overflow-hidden",
        className,
      )}
    >
      {renderHeader && (
        <div className="flex h-7 shrink-0 items-center gap-3 border-b-4 border-foreground bg-background px-5 pb-2 box-content">
          {sources.length > 1 ? (
            <div className="flex items-center gap-1 text-base">
              {sources.map((s) => (
                <button
                  key={s.fileId}
                  type="button"
                  onClick={() => setActiveFileId(s.fileId)}
                  className={cn(
                    "rounded-md px-2 py-0.5 transition-colors outline-none focus-visible:text-accent",
                    s.fileId === active.fileId
                      ? "bg-pick-selected text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s.fileName}
                </button>
              ))}
            </div>
          ) : (
            <span className="text-base font-medium text-foreground">
              {active.fileName}
            </span>
          )}
          {active.source !== "output" && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">
                {sourceLabel(active)}{" "}
                <span className="tabular-nums">v{active.versionNumber}</span>
              </span>
            </>
          )}
          {override && onClearOverride && (
            <button
              type="button"
              onClick={onClearOverride}
              className="ml-auto inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:text-accent"
              aria-label="Show latest version"
            >
              <XIcon size={14} />
              <span className="underline decoration-dotted underline-offset-4">
                Show latest
              </span>
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              title={closeLabel ?? "Close"}
              aria-label={closeLabel ?? "Close"}
              className={cn(
                "inline-flex items-center justify-center text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:text-accent",
                override && onClearOverride ? "" : "ml-auto",
              )}
            >
              <XIcon size={20} />
            </button>
          )}
        </div>
      )}
      <ViewerCache sources={sources} active={active} override={override} />
    </div>
  );
}

/** Mount-once cache for renderered sources. Keeps each source's
 *  DraftViewerRenderer alive after first activation so switching
 *  tabs is instant — no re-fetch, no re-render. Hidden sources sit
 *  absolutely positioned behind the active one with `visibility:
 *  hidden`, preserving scroll position and DOM state. */
function ViewerCache({
  sources,
  active,
  override,
}: {
  sources: DraftViewerSource[];
  active: DraftViewerSource;
  override?: DraftViewerSource;
}) {
  // Each source we've ever activated stays mounted thereafter. The
  // override (proposal deep-link) is mounted alongside the active
  // tab so flipping back to "latest" doesn't lose its render either.
  const [mountedIds, setMountedIds] = useState<Set<string>>(
    () => new Set([active.versionId]),
  );
  useEffect(() => {
    setMountedIds((prev) => {
      if (prev.has(active.versionId)) return prev;
      const next = new Set(prev);
      next.add(active.versionId);
      return next;
    });
  }, [active.versionId]);

  // Stable list of sources to actually render (the ones we've
  // mounted at least once + the override if present).
  const renderList = useMemo(() => {
    const out: DraftViewerSource[] = [];
    const seen = new Set<string>();
    for (const s of sources) {
      if (mountedIds.has(s.versionId) && !seen.has(s.versionId)) {
        out.push(s);
        seen.add(s.versionId);
      }
    }
    if (override && !seen.has(override.versionId)) {
      out.push(override);
    }
    return out;
  }, [sources, mountedIds, override]);

  return (
    <div className="relative flex-1 min-h-0">
      {renderList.map((s) => {
        const isActive = s.versionId === active.versionId;
        return (
          <div
            key={s.versionId}
            className={cn(
              "absolute inset-0 flex flex-col",
              !isActive && "invisible pointer-events-none",
            )}
            aria-hidden={!isActive}
          >
            <DraftViewerRenderer source={s} />
          </div>
        );
      })}
    </div>
  );
}

function DraftViewerRenderer({ source }: { source: DraftViewerSource }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // The render is keyed on versionId + source kind: a new version
  // (or a kind-flip) re-mints + re-renders. getUrl is treated as a
  // stable callback the caller owns — including it would refire on
  // every parent re-render unless the caller memoises.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above.
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setErrorMessage(null);
    const container = containerRef.current;
    if (!container) return;
    // Clear any previous render.
    container.replaceChildren();

    (async () => {
      try {
        // Mint a fresh signed URL via the source's callback right
        // before fetching. The URL never lives in the SSR payload, so
        // it can't go stale before we use it.
        const minted = await source.getUrl("view");
        if (cancelled) return;
        if ("error" in minted) {
          throw new Error(`Could not mint URL: ${minted.error}`);
        }
        const res = await fetch(minted.url);
        if (!res.ok) {
          throw new Error(`Fetch failed: ${res.status}`);
        }
        const blob = await res.blob();
        if (cancelled) return;
        // Lazy-load docx-preview so it doesn't bloat the initial
        // bundle for users who never open the Draft view.
        const { renderAsync } = await import("docx-preview");
        if (cancelled) return;
        await renderAsync(blob, container, undefined, {
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          experimental: true,
          // Render `<w:ins>` / `<w:del>` as proper tracked changes —
          // green underline + red strikethrough — instead of the
          // accepted view.
          renderChanges: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
        });
        if (cancelled) return;
        setStatus("ready");
        // Scroll the first tracked change into view so the user lands
        // on the edit rather than the document's top boilerplate. Only
        // applies to proposal / accepted drafts (uploads have no ins
        // or del). A small top offset keeps the anchor below the
        // header strip.
        if (source.source !== "upload") {
          const firstChange = container.querySelector(
            "ins, del, .docx-ins, .docx-del",
          );
          const scroll = scrollRef.current;
          if (firstChange && scroll) {
            const targetRect = firstChange.getBoundingClientRect();
            const scrollRect = scroll.getBoundingClientRect();
            const offset = targetRect.top - scrollRect.top + scroll.scrollTop;
            scroll.scrollTo({
              top: Math.max(0, offset - 24),
              behavior: "auto",
            });
          }
        }
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source.versionId, source.source]);

  return (
    // The scroll container shares docx-preview's wrapper colour so the
    // seam below the last page (where `.docx-wrapper` ends) doesn't
    // reveal a different bg as the user scrolls. The host fills the
    // viewport (`min-h-full`) so short documents still cover the canvas.
    <div
      ref={scrollRef}
      className="relative flex-1 min-h-0 overflow-y-auto bg-foreground dark:bg-background"
    >
      <div ref={containerRef} className={cn("docx-host", "min-h-full")} />
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center text-foreground">
          <Shimmer>Loading draft</Shimmer>
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-destructive">
          {errorMessage}
        </div>
      )}
    </div>
  );
}
