"use client";

// Run renderer. Pure parts walker: partitions the assistant
// message into "turn blocks" at each `data-turn` boundary, then
// routes text/tool parts to the center conversation column and
// reasoning parts to the matching Blue/Red Breakout side panel.
//
// No `isStreaming` prop on individual turns — the last block is
// considered in-flight whenever `chat.status` is streaming/submitted.

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
} from "@/components/ai-elements/reasoning";
import {
  DraftViewer,
  type DraftViewerSource,
} from "@/components/draft-viewer/draft-viewer";
import { AGENT_BADGE, ROLE_LABEL } from "@/components/messages/agent-badge";
import { formatDuration, formatTime } from "@/components/messages/format";
import { PanelShell } from "@/components/messages/panel-shell";
import { Button } from "@/components/ui/button";
import {
  type DrafterPhase,
  DraftingStatusIndicator,
} from "@/components/ui/drafting-status-indicator";
import { TabItem, Tabs, TabsList } from "@/components/ui/tabs";
import { ThinkingIndicator } from "@/components/ui/thinking-indicator";
import { getMemoUrl } from "@/lib/actions/memo";
import { getRedlineUrl } from "@/lib/actions/redline";
import type { WargameUIMessage } from "@/lib/ui-message";
import { cn } from "@/lib/utils";
import type { Tables } from "@/types/database.types";
import {
  ArrowDownIcon,
  FilesIcon,
  UserCircleMinusIcon,
  UserCirclePlusIcon,
  VideoConferenceIcon,
  XIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { Shimmer } from "../ai-elements/shimmer";

type OutputMode = "debate" | "output";
type OutputKind = "redline" | "memo";

const NOOP = () => {};

type Issue = Tables<"issues">;
type ChatStatus = "submitted" | "streaming" | "ready" | "error";

type DataTurn =
  | {
      kind: "review";
      side: "blue" | "red";
      startedAt: number;
      completedAt?: number;
    }
  | {
      kind: "argument";
      side: "blue" | "red";
      issueId: string;
      startedAt: number;
      completedAt?: number;
    }
  | {
      // End-of-run drafting phase. D4 (next commit) will add a
      // proper render path; for now the partition function captures
      // it but the existing column/panel filters silently ignore it.
      kind: "drafting";
      side: "neutral";
      startedAt: number;
      completedAt?: number;
    }
  | {
      // End-of-run memo phase. Sibling to drafting — fires whenever
      // unresolved+deferred > 0.
      kind: "memo";
      side: "neutral";
      startedAt: number;
      completedAt?: number;
    };

/** Join consecutive `reasoning` parts with a markdown paragraph
 *  break. Within one turn we keep the gap modest; the larger
 *  separator lives BETWEEN turns (driven by the column's `gap-*`). */
function joinReasoning(parts: ReadonlyArray<{ text: string }>): string {
  return parts
    .map((r) => r.text)
    .filter((t) => t.length > 0)
    .join("\n\n");
}

// Shared className stack for any Streamdown-rendered prose surface
// (center conversation column + Blue/Red reasoning panels). Extracted
// here so the two callers can't drift apart — when this branch existed
// as inline strings in two places, a fix to one (li leading) silently
// missed the other. See the `Prose()` comment for why we don't layer
// Tailwind typography on top of Streamdown.
const STREAMDOWN_PROSE = cn(
  // Uniform line-height across the prose tree. Setting it on the
  // wrapper covers everything Streamdown renders (p, li, blockquote,
  // etc.); the per-element selectors below are belt-and-braces for
  // elements where Streamdown ships its own leading utility class
  // that would otherwise win.
  "leading-5.5",
  "[&_p]:leading-5.5 [&_p]:my-2",
  // Streamdown wraps list-item content in <p data-[&_p]:inline>, so
  // the <li>'s own `line-height` (24px default) lays out the line
  // box — the inline <p>'s leading doesn't apply. Pin the `<li>`
  // explicitly so list rows match the surrounding paragraphs.
  "[&_li]:leading-5.5",
  // The same `[&_p]:my-2` rule above lands INSIDE every list item
  // (loose-list rendering: `<li><p>…</p></li>`) and bloats them with
  // 8px top/bottom padding. Zero out paragraph margins inside list
  // items so item spacing is controlled by the `<li>` itself.
  "[&_li_p]:my-0",
  // Override Streamdown's `list-inside` default: bullets/numbers
  // hang outside the text column so wrapped text aligns with itself
  // rather than starting under the marker. pl-5 leaves just enough
  // room for the marker without indenting the text away from the
  // column edge.
  "[&_ul]:list-outside [&_ul]:pl-5 [&_ol]:list-outside [&_ol]:pl-5",
  // Flatten heading sizes to body text. Streamdown ships h1=3xl,
  // h2=2xl, h3=xl, h4=lg etc. — visually loud in a tight side panel
  // and clashes with the column's own typographic hierarchy. Bold +
  // the existing top margin are enough to mark a heading; size isn't
  // doing useful work here.
  "[&_h1]:text-base [&_h2]:text-base [&_h3]:text-base [&_h4]:text-base [&_h5]:text-base [&_h6]:text-base",
);

function Prose({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  if (!text || text.trim().length === 0) return null;
  return (
    <MessageResponse className={cn(STREAMDOWN_PROSE, className)}>
      {text}
    </MessageResponse>
  );
}

/** Ticks once per second while `active` so streaming-elapsed counters
 *  refresh without busy-looping the whole tree on every chunk. */
function useTickWhile(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const handle = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, [active]);
  return now;
}

function TurnTiming({
  startedAt,
  completedAt,
  isStreaming,
  now,
}: {
  startedAt: number | undefined;
  completedAt: number | undefined;
  isStreaming: boolean;
  now: number;
}) {
  if (!startedAt) return null;
  if (completedAt) {
    return (
      <span className="font-mono text-xs tracking-tight tabular-nums text-muted-foreground">
        {formatTime(startedAt)}
      </span>
    );
  }
  if (isStreaming) {
    const elapsed = Math.max(0, now - startedAt);
    return (
      <span className="text-xs text-muted-foreground">
        <Shimmer>Streaming</Shimmer> ·{" "}
        <span className="font-mono tracking-tight tabular-nums">
          {formatDuration(elapsed)}
        </span>
      </span>
    );
  }
  // Turn started but no completedAt and not currently streaming — the
  // stream was likely aborted. Show start time only.
  return (
    <span className="tabular-nums text-muted-foreground">
      {formatTime(startedAt)}
    </span>
  );
}

type TextPart = { type: "text"; text: string };
type ReasoningPart = { type: "reasoning"; text: string };
type ToolPart = {
  type: `tool-${string}`;
  state?: string;
  input?: unknown;
  output?: unknown;
  toolCallId?: string;
};

interface TurnBlock {
  kind: "turn";
  key: string;
  meta: DataTurn;
  text: TextPart[];
  reasoning: ReasoningPart[];
  tools: ToolPart[];
}

type Placeholder = {
  key: string;
  description: string;
  bluePosition?: string;
  redPosition?: string;
};

type ResolutionPartData = {
  issueId: string;
  outcome: "converged" | "pending-input" | "cap-hit";
  turnsUsed: number;
  brief?: string;
  placeholders?: Placeholder[];
  reason: string;
};

interface ResolutionBlock extends ResolutionPartData {
  kind: "resolution";
  key: string;
}

type Block = TurnBlock | ResolutionBlock;

type RedlinePartData = {
  storageKey: string;
  downloadFilename: string;
  changesApplied: number;
  changesErrored: number;
};

type MemoPartData = {
  storageKey: string;
  downloadFilename: string;
  agreedCount: number;
  openCount: number;
  notYetDiscussedCount: number;
  summary: string;
};

type PhaseErrorPartData = {
  phase: "drafting" | "memo";
  message: string;
  status: number | null;
  at: number;
};

interface PartitionResult {
  blocks: Block[];
  /** The final redline produced by the end-of-run drafting phase, if
   *  any. The route emits one `data-redline` part after compile
   *  succeeds. */
  redline: RedlinePartData | null;
  /** The final memo produced by the end-of-run memo phase, if any. */
  memo: MemoPartData | null;
  /** Per-phase errors emitted when drafting or memo failed
   *  mid-stream. The route catches the exception, captures to Sentry,
   *  and writes one `data-phase-error` per failed phase. */
  phaseErrors: PhaseErrorPartData[];
}

function partition(message: WargameUIMessage | undefined): PartitionResult {
  if (!message)
    return { blocks: [], redline: null, memo: null, phaseErrors: [] };
  const blocks: Block[] = [];
  let redline: RedlinePartData | null = null;
  let memo: MemoPartData | null = null;
  const phaseErrors: PhaseErrorPartData[] = [];
  let cur: TurnBlock | null = null;
  const flush = () => {
    if (cur) {
      blocks.push(cur);
      cur = null;
    }
  };
  for (const p of message.parts) {
    if (p.type === "data-turn") {
      flush();
      const data = (p as { id?: string; data: DataTurn }).data;
      const id = (p as { id?: string }).id ?? `turn-${blocks.length}`;
      cur = {
        kind: "turn",
        key: id,
        meta: data,
        text: [],
        reasoning: [],
        tools: [],
      };
      continue;
    }
    if (p.type === "data-resolution") {
      flush();
      const d = (p as { id?: string; data: ResolutionPartData }).data;
      const id = (p as { id?: string }).id ?? `resolution-${blocks.length}`;
      blocks.push({
        kind: "resolution",
        key: id,
        issueId: d.issueId,
        outcome: d.outcome,
        turnsUsed: d.turnsUsed,
        brief: d.brief,
        placeholders: d.placeholders,
        reason: d.reason,
      });
      continue;
    }
    if (p.type === "data-redline") {
      // Module-level; doesn't close any block.
      redline = (p as { data: RedlinePartData }).data;
      continue;
    }
    if (p.type === "data-memo") {
      memo = (p as { data: MemoPartData }).data;
      continue;
    }
    if (p.type === "data-phase-error") {
      phaseErrors.push((p as { data: PhaseErrorPartData }).data);
      continue;
    }
    if (!cur) continue;
    if (p.type === "text") cur.text.push(p as TextPart);
    else if (p.type === "reasoning") cur.reasoning.push(p as ReasoningPart);
    else if (typeof p.type === "string" && p.type.startsWith("tool-")) {
      cur.tools.push(p as ToolPart);
    }
  }
  flush();
  return { blocks, redline, memo, phaseErrors };
}

export function RunRenderer({
  message,
  status,
  issues,
  blueLabel,
  redLabel,
  projectId,
}: {
  message: WargameUIMessage | undefined;
  status: ChatStatus;
  issues: Issue[];
  blueLabel?: string;
  redLabel?: string;
  projectId: string;
}) {
  const { blocks, redline, memo, phaseErrors } = partition(message);
  const draftingError = phaseErrors.find((e) => e.phase === "drafting") ?? null;
  const memoError = phaseErrors.find((e) => e.phase === "memo") ?? null;
  const isStreaming = status === "streaming" || status === "submitted";
  const lastBlockKey = blocks[blocks.length - 1]?.key;
  const liveBlockKey = isStreaming ? lastBlockKey : undefined;
  // R3: drive a once-per-second clock while anything is streaming
  // so the elapsed counter on the in-flight turn refreshes.
  const now = useTickWhile(isStreaming);

  const issueTitleById = new Map(issues.map((i) => [i.id, i.title]));

  const turnBlocks = blocks.filter((b): b is TurnBlock => b.kind === "turn");
  const blueBlocks = turnBlocks.filter((b) => b.meta.side === "blue");
  const redBlocks = turnBlocks.filter((b) => b.meta.side === "red");

  // Plan-10 step 2: collect available outputs into a typed list. When
  // zero exist, the toggle is absent and the renderer behaves as
  // before. When one or more exist, the Conference Room header gains
  // a Debate ↔ Output toggle and (in output mode) a full-width
  // DraftViewer takes the place of the three-column grid.
  const outputs = useMemo<
    Array<{ kind: OutputKind; source: DraftViewerSource }>
  >(() => {
    const out: Array<{ kind: OutputKind; source: DraftViewerSource }> = [];
    if (redline) {
      out.push({
        kind: "redline",
        source: {
          // fileName doubles as the tab label in DraftViewer's
          // built-in multi-source tab strip, so we use the short
          // semantic name ("Redline") rather than the .docx
          // filename here. The download dialog still uses the full
          // .docx filename via `downloadFilename`.
          fileId: "redline",
          fileName: "Redline",
          versionId: redline.storageKey,
          source: "output",
          versionNumber: 1,
          getUrl: (mode) =>
            getRedlineUrl({
              projectId,
              storageKey: redline.storageKey,
              downloadFilename: redline.downloadFilename,
              mode,
            }),
        },
      });
    }
    if (memo) {
      out.push({
        kind: "memo",
        source: {
          fileId: "memo",
          fileName: "Memo",
          versionId: memo.storageKey,
          source: "output",
          versionNumber: 1,
          getUrl: (mode) =>
            getMemoUrl({
              projectId,
              storageKey: memo.storageKey,
              downloadFilename: memo.downloadFilename,
              mode,
            }),
        },
      });
    }
    return out;
  }, [redline, memo, projectId]);
  const outputsAvailable = outputs.length > 0;
  const [mode, setMode] = useState<OutputMode>("debate");
  const effectiveMode: OutputMode = outputsAvailable ? mode : "debate";
  const [activeOutput, setActiveOutput] = useState<OutputKind>("redline");
  // If the user selected a tab that no longer exists (e.g. only memo
  // came back), fall back to the first available output.
  const activeSource =
    outputs.find((o) => o.kind === activeOutput) ?? outputs[0];

  const onToggleMode = () =>
    setMode((m) => (m === "debate" ? "output" : "debate"));
  // "View redline" / "View memo" affordances flip to output mode and
  // select the matching tab, instead of opening a new browser tab.
  const onViewOutput = (kind: OutputKind) => {
    setActiveOutput(kind);
    setMode("output");
  };

  const isOutput = effectiveMode === "output" && !!activeSource;
  // Title pill: derive from the ACTIVE output so switching tabs
  // changes the label. Show the underlying contract filename plus a
  // parenthetical for which output we're viewing.
  const documentTitle = (() => {
    if (!activeSource) return null;
    const fn =
      activeSource.kind === "redline"
        ? redline?.downloadFilename
        : memo?.downloadFilename;
    if (!fn) return null;
    const base = fn.replace(/\.(redline|memo)\.docx$/i, ".docx");
    const variant = activeSource.kind === "redline" ? "Redline" : "Memo";
    return `${base} (${variant})`;
  })();

  // Animation timings lifted from messages-stream.tsx. The conf
  // column moves on-screen between grid cells → strong ease-in-out
  // (quart). Blue + Red panels enter/exit the viewport → strong
  // ease-out (quint), translateX only.
  const shouldReduceMotion = useReducedMotion();
  const confTransition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: 0.28, ease: [0.77, 0, 0.175, 1] as const };
  const breakoutTransition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: 0.28, ease: [0.23, 1, 0.32, 1] as const };

  return (
    <div className="relative h-full min-h-0">
      {/* The DraftViewer sits behind the grid at right 60%. The conf
       *  column overlaps it at left 40% in output mode (grid shrinks).
       *  In debate mode the grid covers the viewer entirely. */}
      {outputsAvailable && activeSource && (
        <div
          className="absolute inset-y-0 right-0 z-0 flex flex-col"
          style={{ width: "60%" }}
        >
          {/* No built-in header on the viewer — we render our own
           *  controls as floating chrome above the document content.
           *  Lets the Tabs pill take its natural shape instead of
           *  being shoehorned into a flat bar. */}
          <DraftViewer
            sources={outputs.map((o) => o.source)}
            activeFileId={activeSource.source.fileId}
            onActiveFileIdChange={(id) =>
              setActiveOutput(id === "memo" ? "memo" : "redline")
            }
            className="flex-1"
            renderHeader={false}
          />
          {/* Floating chrome: Redline/Memo tabs on the left, contract
           *  title pill in the centre, close button on the right. All
           *  absolutely positioned over the viewer's docx-preview
           *  area so they persist during scroll. */}
          {outputs.length > 1 ? (
            <div className="pointer-events-none absolute top-3 left-3 z-10">
              <div className="pointer-events-auto dark">
                <Tabs
                  value={activeOutput}
                  onValueChange={(v) =>
                    setActiveOutput(v === "memo" ? "memo" : "redline")
                  }
                >
                  <TabsList>
                    {outputs.map((o) => (
                      <TabItem
                        key={o.kind}
                        value={o.kind}
                        label={o.kind === "redline" ? "Redline" : "Memo"}
                      />
                    ))}
                  </TabsList>
                </Tabs>
              </div>
            </div>
          ) : null}
          {documentTitle ? (
            <div className="pointer-events-none absolute top-3 left-1/2 z-10 -translate-x-1/2">
              <span className="rounded-full bg-black/55 px-3 py-1 text-xs font-medium text-white shadow-sm backdrop-blur-sm">
                {documentTitle}
              </span>
            </div>
          ) : null}
          <button
            type="button"
            onClick={onToggleMode}
            title="Switch to debate view"
            aria-label="Switch to debate view"
            className="dark absolute top-3 right-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-background/80 text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-background hover:text-foreground focus:outline-none focus-visible:text-accent"
          >
            <XIcon size={18} />
          </button>
        </div>
      )}
      <motion.div
        layout
        transition={confTransition}
        className={cn(
          "pointer-events-none relative z-10 grid h-full min-h-0 grid-cols-1 gap-0 overflow-hidden",
          isOutput
            ? "lg:grid-cols-[minmax(0,40%)]"
            : "lg:grid-cols-[1fr_minmax(0,1.4fr)_1fr]",
        )}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {!isOutput && (
            <motion.div
              key="blue"
              initial={{ transform: "translateX(-100%)" }}
              animate={{ transform: "translateX(0%)" }}
              exit={{ transform: "translateX(-100%)" }}
              transition={breakoutTransition}
              className="pointer-events-auto min-h-0 bg-background"
            >
              <ReasoningColumn
                agent="blue"
                blocks={blueBlocks}
                issueTitleById={issueTitleById}
                liveBlockKey={liveBlockKey}
                now={now}
                subtitle={blueLabel}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          layout
          transition={confTransition}
          className="pointer-events-auto min-h-0 bg-background"
        >
          <CenterColumn
            blocks={blocks}
            issueTitleById={issueTitleById}
            liveBlockKey={liveBlockKey}
            now={now}
            redline={redline}
            memo={memo}
            draftingError={draftingError}
            memoError={memoError}
            projectId={projectId}
            mode={effectiveMode}
            outputsAvailable={outputsAvailable}
            onToggleMode={onToggleMode}
            onViewOutput={onViewOutput}
          />
        </motion.div>

        <AnimatePresence initial={false} mode="popLayout">
          {!isOutput && (
            <motion.div
              key="red"
              initial={{ transform: "translateX(100%)" }}
              animate={{ transform: "translateX(0%)" }}
              exit={{ transform: "translateX(100%)" }}
              transition={breakoutTransition}
              className="pointer-events-auto min-h-0 bg-background"
            >
              <ReasoningColumn
                agent="red"
                blocks={redBlocks}
                issueTitleById={issueTitleById}
                liveBlockKey={liveBlockKey}
                now={now}
                subtitle={redLabel}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function CenterColumn({
  blocks,
  issueTitleById,
  liveBlockKey,
  now,
  redline,
  memo,
  draftingError,
  memoError,
  projectId,
  mode,
  outputsAvailable,
  onToggleMode,
  onViewOutput,
}: {
  blocks: Block[];
  issueTitleById: Map<string, string>;
  liveBlockKey: string | undefined;
  now: number;
  redline: RedlinePartData | null;
  memo: MemoPartData | null;
  draftingError: PhaseErrorPartData | null;
  memoError: PhaseErrorPartData | null;
  projectId: string;
  mode: OutputMode;
  outputsAvailable: boolean;
  onToggleMode: () => void;
  onViewOutput: (kind: OutputKind) => void;
}) {
  // R1: review turns belong to the side panel. The center column
  // shows argument turns, resolution markers, and the end-of-run
  // drafting / memo turns.
  const centerBlocks = blocks.filter(
    (b) =>
      b.kind === "resolution" ||
      (b.kind === "turn" &&
        (b.meta.kind === "argument" ||
          b.meta.kind === "drafting" ||
          b.meta.kind === "memo")),
  );
  // The conf header only carries the "open output" affordance.
  // In output mode, the close action moves to the DraftViewer's
  // own header (XIcon on the right).
  const showToggle = outputsAvailable && mode === "debate";
  const action = showToggle ? (
    <Button
      variant="icon"
      size="icon"
      onClick={onToggleMode}
      title="Switch to output view"
      aria-label="Switch to output view"
      aria-pressed={false}
      className="h-5 hit-area-3"
    >
      <FilesIcon size={24} />
    </Button>
  ) : undefined;
  return (
    <PanelShell
      icon={VideoConferenceIcon}
      title="Negotiation"
      action={action}
      className={cn(mode === "debate" ? "px-10" : "pr-10")}
    >
      <Conversation className="flex-1 min-h-0">
        <ConversationContent className="gap-12 px-0 py-6">
          {centerBlocks.length === 0 ? (
            <ConversationEmptyState
              icon={<VideoConferenceIcon className="size-6" weight="duotone" />}
              title="Waiting on the agents"
              description="Blue and Red will start arguing the issues here once their initial reviews are in."
            />
          ) : (
            (() => {
              // Coalesce: only the first argument turn in a same-issue
              // run shows the "Re: {title}" subheading. Resolutions
              // and non-argument blocks reset the chain.
              let prevIssueId = "";
              return centerBlocks.map((block) => {
                if (block.kind === "resolution") {
                  prevIssueId = "";
                  return (
                    <ResolutionMarker
                      key={block.key}
                      block={block}
                      issueTitleById={issueTitleById}
                    />
                  );
                }
                // turn block
                if (block.meta.kind === "drafting") {
                  prevIssueId = "";
                  return (
                    <DraftingTurn
                      key={block.key}
                      block={block}
                      isStreaming={block.key === liveBlockKey}
                      now={now}
                      redline={redline}
                      error={draftingError}
                      projectId={projectId}
                      onView={() => onViewOutput("redline")}
                    />
                  );
                }
                if (block.meta.kind === "memo") {
                  prevIssueId = "";
                  return (
                    <MemoTurn
                      key={block.key}
                      block={block}
                      isStreaming={block.key === liveBlockKey}
                      now={now}
                      memo={memo}
                      error={memoError}
                      projectId={projectId}
                      onView={() => onViewOutput("memo")}
                    />
                  );
                }
                const argumentIssueId =
                  block.meta.kind === "argument" ? block.meta.issueId : "";
                const showIssueTitle = argumentIssueId !== prevIssueId;
                prevIssueId = argumentIssueId;
                return (
                  <CenterTurn
                    key={block.key}
                    block={block}
                    issueTitleById={issueTitleById}
                    isStreaming={block.key === liveBlockKey}
                    now={now}
                    showIssueTitle={showIssueTitle}
                  />
                );
              });
            })()
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </PanelShell>
  );
}

function ResolutionMarker({
  block,
  issueTitleById,
}: {
  block: ResolutionBlock;
  issueTitleById: Map<string, string>;
}) {
  const issueTitle = issueTitleById.get(block.issueId);
  const verb =
    block.outcome === "converged"
      ? "resolved"
      : block.outcome === "pending-input"
        ? "resolved pending input"
        : "unresolved";
  const hasBrief = !!block.brief;
  const placeholders = block.placeholders ?? [];
  return (
    <div className="text-foreground border-l-4 border-team-green pl-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="font-medium text-team-green">Green</span>
        <span>·</span>
        <span>
          Marking as {verb} after {block.turnsUsed} turn
          {block.turnsUsed === 1 ? "" : "s"}
        </span>
      </div>
      {issueTitle ? (
        <p className="opacity-50 font-display italic leading-6 font-medium">
          Re: {issueTitle}.
        </p>
      ) : null}
      {hasBrief && block.brief ? <Prose text={block.brief} /> : null}
      {placeholders.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="opacity-50">
            {placeholders.length} decision
            {placeholders.length === 1 ? "" : "s"} pending input:
          </p>
          <ul className="flex flex-col gap-2">
            {placeholders.map((p) => (
              <li key={p.key} className="flex flex-col gap-1">
                <span className="font-medium">{p.description}</span>
                {p.bluePosition ? (
                  <span className="opacity-70">
                    <span className="text-team-blue">Blue:</span>{" "}
                    {p.bluePosition}
                  </span>
                ) : null}
                {p.redPosition ? (
                  <span className="opacity-70">
                    <span className="text-team-red">Red:</span> {p.redPosition}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function DraftingTurn({
  block,
  isStreaming,
  now,
  redline,
  error,
  projectId,
  onView,
}: {
  block: TurnBlock;
  isStreaming: boolean;
  now: number;
  redline: RedlinePartData | null;
  error: PhaseErrorPartData | null;
  projectId: string;
  onView: () => void;
}) {
  if (block.meta.kind !== "drafting") return null;
  // We intentionally do NOT render the drafter's reasoning here.
  // It's internal cross-reference scanning and edit planning that
  // duplicates the visible summary + redline. Surfaced before as a
  // wall of text on Anthropic and confused users about what the
  // memo / redline actually was.
  const submitPart = block.tools.find((t) => t.type === "tool-submit_edits");
  const submitInput = submitPart?.input as
    | { edits?: unknown[]; summary?: string }
    | undefined;
  const submitInputAvailable =
    submitPart?.state === "input-available" ||
    submitPart?.state === "output-available";
  const summary = submitInputAvailable ? (submitInput?.summary ?? "") : "";
  // The drafter call streams contract markdown the user can't see,
  // then runs an opaque .docx compile. Surface what phase we're in
  // so the block doesn't look stuck for the full ~60s.
  //   - "drafting": streamText is still going (no submit tool yet)
  //   - "compiling": tool landed but redline upload hasn't finished
  //   - null: redline arrived, the affordance speaks for itself
  const drafterPhase: DrafterPhase | null = redline
    ? null
    : submitInputAvailable
      ? "compiling"
      : isStreaming
        ? "drafting"
        : null;
  return (
    <div className="text-foreground border-l-4 border-foreground pl-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="font-medium">Black</span>
        <span>·</span>
        <span>Revised draft</span>
      </div>
      <TurnTiming
        startedAt={block.meta.startedAt}
        completedAt={block.meta.completedAt}
        isStreaming={isStreaming}
        now={now}
      />

      {summary ? <Prose text={summary} /> : null}
      {drafterPhase ? (
        <DraftingStatusIndicator
          phase={drafterPhase}
          className="text-muted-foreground"
        />
      ) : null}
      {redline ? (
        <RedlineAffordance
          redline={redline}
          projectId={projectId}
          onView={onView}
        />
      ) : error ? (
        <PhaseErrorNote phase="redline" error={error} />
      ) : null}
    </div>
  );
}

function RedlineAffordance({
  redline,
  projectId,
  onView,
}: {
  redline: RedlinePartData;
  projectId: string;
  onView: () => void;
}) {
  const onDownload = async () => {
    const result = await getRedlineUrl({
      projectId,
      storageKey: redline.storageKey,
      downloadFilename: redline.downloadFilename,
      mode: "download",
    });
    if ("error" in result) {
      console.warn("[poc-renderer] redline url failed", result.error);
      return;
    }
    window.open(result.url, "_blank", "noopener");
  };
  const noteParts: string[] = [
    `${redline.changesApplied} change${redline.changesApplied === 1 ? "" : "s"} applied`,
  ];
  if (redline.changesErrored > 0) {
    noteParts.push(`${redline.changesErrored} not applied`);
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-foreground font-display italic font-medium">
        Redline · {noteParts.join(", ")}.
      </p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pb-4">
        <button
          type="button"
          onClick={onView}
          className="underline decoration-dotted underline-offset-4 hover:text-accent focus:outline-none focus-visible:text-accent inline-flex items-center gap-1.5 hit-area-3 whitespace-nowrap"
        >
          <FilesIcon size={20} />
          <span>View redline</span>
        </button>
        <span aria-hidden className="text-muted-foreground">
          ·
        </span>
        <button
          type="button"
          onClick={onDownload}
          className="underline decoration-dotted underline-offset-4 hover:text-accent focus:outline-none focus-visible:text-accent inline-flex items-center gap-1.5 hit-area-3 whitespace-nowrap"
        >
          <ArrowDownIcon size={20} />
          <span>Download .docx</span>
        </button>
      </div>
    </div>
  );
}

function MemoTurn({
  block,
  isStreaming,
  now,
  memo,
  error,
  projectId,
  onView,
}: {
  block: TurnBlock;
  isStreaming: boolean;
  now: number;
  memo: MemoPartData | null;
  error: PhaseErrorPartData | null;
  projectId: string;
  onView: () => void;
}) {
  if (block.meta.kind !== "memo") return null;
  // We intentionally do NOT render the memo's reasoning here. With
  // Anthropic thinking enabled the model dumps an issue-by-issue
  // analysis as reasoning text that visually swamps the actual
  // 2–3-sentence SUMMARY and reads as if it WERE the memo body.
  // The structured submit_memo output is the artifact; thinking is
  // internal and not useful to surface in the conversation column.
  const submitPart = block.tools.find((t) => t.type === "tool-submit_memo");
  const submitInput = submitPart?.input as { summary?: string } | undefined;
  const summary =
    submitPart?.state === "input-available" ||
    submitPart?.state === "output-available"
      ? (submitInput?.summary ?? memo?.summary ?? "")
      : (memo?.summary ?? "");
  return (
    <div>
      <div className="text-foreground border-l-4 border-foreground pl-4 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium">Black</span>
          <span>·</span>
          <span>Memo on open issues</span>
        </div>

        {summary && <Prose text={summary} />}
        {isStreaming && (
          <ThinkingIndicator className="px-0 py-0 text-muted-foreground" />
        )}
        {memo ? (
          <MemoAffordance memo={memo} projectId={projectId} onView={onView} />
        ) : error ? (
          <PhaseErrorNote phase="memo" error={error} />
        ) : null}
      </div>
      <TurnTiming
        startedAt={block.meta.startedAt}
        completedAt={block.meta.completedAt}
        isStreaming={isStreaming}
        now={now}
      />
    </div>
  );
}

/** Inline error note rendered in place of the redline/memo download
 *  affordance when the phase failed mid-stream. Paired with the
 *  Sentry capture on the server — this is the user-facing half. */
function PhaseErrorNote({
  phase,
  error,
}: {
  phase: "redline" | "memo";
  error: PhaseErrorPartData;
}) {
  const label = phase === "redline" ? "Redline" : "Memo";
  return (
    <div
      role="alert"
      className="flex flex-col gap-1 border-l-4 border-destructive bg-destructive/5 pl-3 py-2 pb-4"
    >
      <p className="font-display italic font-medium text-destructive">
        {label} not generated
      </p>
      <p className="text-sm text-muted-foreground">{error.message}</p>
    </div>
  );
}

function MemoAffordance({
  memo,
  projectId,
  onView,
}: {
  memo: MemoPartData;
  projectId: string;
  onView: () => void;
}) {
  const onDownload = async () => {
    const result = await getMemoUrl({
      projectId,
      storageKey: memo.storageKey,
      downloadFilename: memo.downloadFilename,
      mode: "download",
    });
    if ("error" in result) {
      console.warn("[poc-renderer] memo url failed", result.error);
      return;
    }
    window.open(result.url, "_blank", "noopener");
  };
  const noteParts: string[] = [];
  if (memo.openCount > 0) {
    noteParts.push(`${memo.openCount} open`);
  }
  if (memo.notYetDiscussedCount > 0) {
    noteParts.push(`${memo.notYetDiscussedCount} not yet discussed`);
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-foreground font-display italic font-medium">
        Memo · {noteParts.join(", ") || "no open issues"}.
      </p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pb-4">
        <button
          type="button"
          onClick={onView}
          className="underline decoration-dotted underline-offset-4 hover:text-accent focus:outline-none focus-visible:text-accent inline-flex items-center gap-1.5 hit-area-3 whitespace-nowrap"
        >
          <FilesIcon size={20} />
          <span>View memo</span>
        </button>
        <span aria-hidden className="text-muted-foreground">
          ·
        </span>
        <button
          type="button"
          onClick={onDownload}
          className="underline decoration-dotted underline-offset-4 hover:text-accent focus:outline-none focus-visible:text-accent inline-flex items-center gap-1.5 hit-area-3 whitespace-nowrap"
        >
          <ArrowDownIcon size={20} />
          <span>Download .docx</span>
        </button>
      </div>
    </div>
  );
}

function CenterTurn({
  block,
  issueTitleById,
  isStreaming,
  now,
  showIssueTitle,
}: {
  block: TurnBlock;
  issueTitleById: Map<string, string>;
  isStreaming: boolean;
  now: number;
  /** Show the "Re: {issueTitle}." subline. False when the previous
   *  center-column argument was on the same issue. */
  showIssueTitle: boolean;
}) {
  const meta = block.meta;
  // Drafting blocks render via a dedicated path (plan 08 D4); they
  // don't belong in CenterTurn. The upstream filter in CenterColumn
  // already excludes them — this guard is defensive narrowing.
  if (meta.kind !== "review" && meta.kind !== "argument") return null;
  const side = meta.side;
  const isBlue = side === "blue";
  const badge = AGENT_BADGE[side];
  const dbRole = meta.kind;
  const roleLabel = ROLE_LABEL[dbRole];
  const issueId = meta.kind === "argument" ? meta.issueId : null;
  const issueTitle = issueId ? issueTitleById.get(issueId) : undefined;
  const text = block.text.map((t) => t.text).join("");
  const hasContent = text.length > 0 || block.tools.length > 0;

  return (
    <Message from={isBlue ? "user" : "assistant"}>
      <MessageContent
        className={cn(
          "text-foreground border-l-4 pl-4",
          isBlue ? "border-team-blue" : "border-team-red",
        )}
      >
        <div className="flex items-center gap-2">
          <span className={cn("font-medium", badge.tone)}>{badge.label}</span>
          <span>·</span>
          <span>{roleLabel}</span>
        </div>
        {issueTitle && showIssueTitle ? (
          <p className="text-foreground/50 font-display italic font-medium">
            Re: {issueTitle}.
          </p>
        ) : null}

        {text ? (
          <Prose text={text} />
        ) : isStreaming ? (
          <ThinkingIndicator className="px-0 py-0 text-muted-foreground" />
        ) : null}
        {!hasContent && !isStreaming ? null : null}
        {/* Tool parts are reviews (submit_review) — show a tiny
            "issues raised" line if present. Arguments are prose-only. */}
        {block.tools.map((t, i) => (
          <ToolSummary key={`${block.key}-tool-${i}`} part={t} />
        ))}
      </MessageContent>
      <TurnTiming
        startedAt={meta.startedAt}
        completedAt={meta.completedAt}
        isStreaming={isStreaming}
        now={now}
      />
    </Message>
  );
}

function ToolSummary({ part }: { part: ToolPart }) {
  if (part.type !== "tool-submit_review") return null;
  // Render through all three states so the user gets live progress
  // while the submit_review JSON streams in (the 89-second silent
  // beat we used to have between "Reviewing" and the first issue).
  // The AI SDK exposes `input` as the partially-accumulated parsed
  // shape during input-streaming; counting `issues` against that
  // gives an honest "X identified so far" tick.
  const isStreaming = part.state === "input-streaming";
  const isFinal =
    part.state === "input-available" || part.state === "output-available";
  if (!isStreaming && !isFinal) return null;
  const input = part.input as
    | { summary?: string; issues?: unknown[] }
    | undefined;
  const count = input && Array.isArray(input.issues) ? input.issues.length : 0;
  return (
    <p className="font-display italic text-base text-foreground font-medium">
      {isFinal ? (
        <>
          Submitted review · {count} issue{count === 1 ? "" : "s"} raised.
        </>
      ) : (
        <>
          Identifying issues
          {count > 0 ? ` — ${count} found so far…` : "…"}
        </>
      )}
    </p>
  );
}

function ReasoningColumn({
  agent,
  blocks,
  issueTitleById,
  liveBlockKey,
  now,
  subtitle,
}: {
  agent: "blue" | "red";
  blocks: TurnBlock[];
  issueTitleById: Map<string, string>;
  liveBlockKey: string | undefined;
  now: number;
  subtitle?: string;
}) {
  const Icon = agent === "blue" ? UserCirclePlusIcon : UserCircleMinusIcon;
  const textTone = agent === "blue" ? "text-team-blue" : "text-team-red";
  const borderTone = agent === "blue" ? "border-team-blue" : "border-team-red";

  return (
    <PanelShell
      icon={Icon}
      textTone={textTone}
      borderTone={borderTone}
      title={`${agent === "blue" ? "Blue" : "Red"}`}
      subtitle={subtitle}
    >
      <Conversation className="flex-1 min-h-0">
        <ConversationContent className="gap-8 py-6 text-foreground">
          {blocks.length === 0 ? (
            <ConversationEmptyState
              icon={<Icon className="size-6" weight="duotone" />}
              title={`${agent === "blue" ? "Blue" : "Red"} is quiet for now`}
              description={`${agent === "blue" ? "Blue" : "Red"}'s internal discussion appears here once the negotiation starts.`}
            />
          ) : (
            (() => {
              // Coalesce: only the first turn in a same-issue (or
              // same-side review) run shows the heading. Switch issues
              // → next heading reappears.
              let prevKey = "";
              return blocks.map((block) => {
                const key =
                  block.meta.kind === "review"
                    ? `review-${block.meta.side}`
                    : (block.meta as Extract<DataTurn, { kind: "argument" }>)
                        .issueId;
                const showHeading = key !== prevKey;
                prevKey = key;
                return (
                  <ReasoningTurn
                    key={block.key}
                    block={block}
                    issueTitleById={issueTitleById}
                    isStreaming={block.key === liveBlockKey}
                    now={now}
                    showHeading={showHeading}
                  />
                );
              });
            })()
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </PanelShell>
  );
}

function ReasoningTurn({
  block,
  issueTitleById,
  isStreaming,
  now,
  showHeading,
}: {
  block: TurnBlock;
  issueTitleById: Map<string, string>;
  isStreaming: boolean;
  now: number;
  /** Show the issue title (or "Initial review") at the top of this
   *  turn. False when the previous turn in the column was already on
   *  the same issue — avoids repeating the same header on every ping-
   *  pong turn. */
  showHeading: boolean;
}) {
  const isReview = block.meta.kind === "review";
  const heading = isReview
    ? "Initial review"
    : (issueTitleById.get(
        (block.meta as Extract<DataTurn, { kind: "argument" }>).issueId,
      ) ?? "Argument");
  const reasoningText = joinReasoning(block.reasoning);
  const hasReasoning = reasoningText.length > 0;
  // R1: review turns carry their prose preface as a `text` part
  // (the headline takeaway the agent writes before calling
  // submit_review). That belongs on the side panel alongside the
  // reasoning.
  const reviewProse = isReview ? block.text.map((t) => t.text).join("") : "";
  const hasReviewProse = isReview && reviewProse.length > 0;
  // R5: argument turns where the model emitted zero reasoning still
  // produced prose (the argument itself). The center column owns
  // that prose primarily, but a bare heading in the side panel
  // reads as a dead row. Echo the argument prose here with muted
  // styling so the side panel stays informative even when the
  // model skipped the reasoning summary.
  const argumentFallbackProse =
    !isReview && !hasReasoning ? block.text.map((t) => t.text).join("") : "";
  const hasArgumentFallback = argumentFallbackProse.length > 0;
  // R1: surface the submitted-issues count on review blocks.
  const submitReviewPart = isReview
    ? block.tools.find((t) => t.type === "tool-submit_review")
    : undefined;
  // Suppress only argument turns with no content at all. Review
  // turns and argument turns with prose/reasoning are kept.
  if (!isReview && !hasReasoning && !hasArgumentFallback && !isStreaming) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2">
      {showHeading && (
        <span className="font-semibold text-foreground">{heading}</span>
      )}
      {isStreaming &&
        !hasReasoning &&
        !hasReviewProse &&
        !hasArgumentFallback && <ThinkingIndicator className="px-0 py-0" />}
      {hasReasoning && (
        <Reasoning
          isStreaming={isStreaming}
          open
          onOpenChange={NOOP}
          className="mb-0"
        >
          {/* Match the center column's <Prose> paragraph rhythm so
           *  the two columns read at the same cadence. The
           *  reasoning-specific bits (mt-1!, inter-element spacing
           *  via `[&>div>*+*]:mt-3!`) wrap the shared base. */}
          <ReasoningContent
            className={cn("mt-1! [&>div>*+*]:mt-3!", STREAMDOWN_PROSE)}
          >
            {reasoningText}
          </ReasoningContent>
        </Reasoning>
      )}
      {hasReviewProse && (
        <Prose text={reviewProse} className="text-foreground" />
      )}
      {hasArgumentFallback && (
        // Muted on purpose — the canonical prose for argument turns
        // lives in the conference room. This is a side-panel echo so
        // the row isn't empty.
        <Prose text={argumentFallbackProse} className="text-foreground" />
      )}
      {submitReviewPart && <ToolSummary part={submitReviewPart} />}
      <TurnTiming
        startedAt={block.meta.startedAt}
        completedAt={block.meta.completedAt}
        isStreaming={isStreaming}
        now={now}
      />
    </div>
  );
}
