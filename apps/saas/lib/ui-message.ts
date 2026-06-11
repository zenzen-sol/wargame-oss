// Typed `UIMessage` for the wargame chat — plan 07 step 2.
//
// Shape parameters:
//   METADATA      → per-message bookkeeping (agent, dbRole, issueId,
//                   created/completed timestamps). Survives in
//                   `messages.message` and is set both server-side
//                   (chat route onFinish, later steps) and at
//                   backfill time by the DB trigger.
//   DATA_PARTS    → custom stream parts the route emits via
//                   `writer.write({ type: "data-turn", data })` — the
//                   meta tag that routes a turn to a Breakout panel
//                   and pins it to an issue.
//   TOOLS         → review + negotiation tools combined, inferred
//                   from `@wargame-esq/agents`. Tool parts come back
//                   typed: `tool-submit_review`, `tool-propose_clause_edit`,
//                   `tool-accept_proposal`, `tool-mark_impasse`.
//
// `messageRowToUIMessage` is the read-side accessor. The DB trigger
// (migration 20260513000000) writes `message` on every insert/update,
// so callers can just project `row.message` — but we route through a
// typed helper to centralise the cast and give callers autocomplete.

import type { WargameTools } from "@wargame-esq/agents";
import type { UIMessage } from "ai";
import type { Tables } from "@/types/database.types";

/** Per-message metadata persisted on `messages.message.metadata`. */
export type MessageMetadata = {
  /** Which side authored this message (or 'system' for run-level
   *  annotations). Mirrors the legacy `messages.agent` column. */
  agent: "blue" | "red" | "system";
  /** Conceptual role within the workflow. Mirrors `messages.role`. */
  dbRole: "review" | "argument" | "resolution" | "interview" | "thinking";
  /** Pinned issue for argument turns; null for review and system. */
  issueId: string | null;
  /** Epoch ms; mirrors `messages.created_at`. */
  createdAt: number;
  /** Epoch ms; mirrors `messages.completed_at`. Null while in-flight. */
  completedAt: number | null;
  /** Distinct model ids that produced this message. A single
   *  persisted message can span multiple turns (e.g. review + per-
   *  issue argument turns), each potentially hitting a different
   *  tier (`baseline` vs `low`), so this is an array rather than a
   *  single id. Empty / undefined for legacy rows persisted before
   *  this field existed. */
  modelsUsed?: string[];
};

/** `data-turn` data shape — the meta tag the route emits at the
 *  start of each turn so the client can route the live row to the
 *  correct panel.
 *
 *  `startedAt` is set when the turn begins streaming. `completedAt`
 *  is set after the per-turn `streamText` finishes by re-emitting
 *  the same data part (data-part reconciliation: same id → data
 *  field is overwritten — see process-ui-message-stream.ts:816-831).
 *  An in-flight turn has `completedAt: undefined`. */
export type TurnDataPart =
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
      /** End-of-run drafting phase: a neutral agent reads the
       *  agreed briefs and the original contract and produces the
       *  list of anchored edits via the submit_edits tool. One
       *  per run; runs after every issue's argument loop finishes. */
      kind: "drafting";
      side: "neutral";
      startedAt: number;
      completedAt?: number;
    }
  | {
      /** End-of-run memo phase: a neutral agent reads the unresolved
       *  + deferred issue set and produces a downloadable memo via
       *  the submit_memo tool. Sibling to drafting — fires whenever
       *  unresolved+deferred > 0, independent of whether drafting
       *  fired. */
      kind: "memo";
      side: "neutral";
      startedAt: number;
      completedAt?: number;
    };

/** Open decision the supervisor left for human input — a specific
 *  numerical or categorical value the parties circled without
 *  agreeing on. The directive `brief` refers to each by `key`; the
 *  drafter will leave those positions marked for the user. */
export type ResolutionPlaceholder = {
  key: string;
  description: string;
  bluePosition?: string;
  redPosition?: string;
};

/** `data-resolution` shape — emitted by the writer loop after the
 *  silent supervisor decides whether an issue's argument loop is
 *  done. One part per issue.
 *
 *  - `outcome: "converged"` — clean agreement; `brief` describes
 *    what the drafter should implement.
 *  - `outcome: "pending-input"` — structural agreement reached with
 *    one or more specific values left for human decision; `brief`
 *    describes the agreed structure and references each open value
 *    by its `placeholders[].key`.
 *  - `outcome: "cap-hit"` — the per-issue cap fired without the
 *    supervisor declaring convergence. */
export type ResolutionDataPart = {
  issueId: string;
  outcome: "converged" | "pending-input" | "cap-hit";
  turnsUsed: number;
  /** Drafter directive (2–4 sentences). Present when outcome is
   *  "converged" or "pending-input". */
  brief?: string;
  /** Open decisions the supervisor left for human input. Present
   *  when outcome is "pending-input". */
  placeholders?: ResolutionPlaceholder[];
  /** Supervisor's one-sentence rationale, kept for telemetry /
   *  transparency. */
  reason: string;
};

/** `data-redline` shape — emitted by the writer loop after the
 *  Drafter completes and the redline-compile step has uploaded the
 *  tracked-change .docx. One per run. The client uses this to show a
 *  View / Download affordance pointing at the persisted .docx. */
export type RedlineDataPart = {
  storageKey: string;
  downloadFilename: string;
  changesApplied: number;
  changesErrored: number;
};

/** `data-memo` shape — emitted by the writer loop after the memo
 *  agent's structured output has been compiled into a `.docx` and
 *  uploaded to Storage. One per run. The client uses this to show a
 *  View / Download affordance for the memo. */
export type MemoDataPart = {
  storageKey: string;
  downloadFilename: string;
  agreedCount: number;
  openCount: number;
  notYetDiscussedCount: number;
  /** Plain-prose summary the memo agent wrote. Surfaced inline in the
   *  conversation column as the human-readable companion to the
   *  download. */
  summary: string;
};

/** `data-phase-error` shape — emitted when an end-of-run phase
 *  (drafting or memo) throws and we don't want the whole run to die
 *  silently. The route catches the error, captures it to Sentry, and
 *  writes one of these so the UI can surface a human-readable
 *  failure note inside the conversation column. */
export type PhaseErrorDataPart = {
  phase: "drafting" | "memo";
  /** Short, human-readable message. Already sanitized for the client
   *  — no stack traces, no internal paths. */
  message: string;
  /** HTTP status code when the underlying error was an API call
   *  failure (e.g. 529 from Anthropic), else null. Helps the UI tune
   *  copy ("provider overloaded" vs generic). */
  status: number | null;
  /** Epoch ms — when the failure was caught. */
  at: number;
};

/** Data-part registry. Keyed by the suffix after `data-`. */
export type WargameDataParts = {
  turn: TurnDataPart;
  resolution: ResolutionDataPart;
  redline: RedlineDataPart;
  memo: MemoDataPart;
  "phase-error": PhaseErrorDataPart;
};

/** The typed message shape `useChat` returns and the renderer
 *  consumes. */
export type WargameUIMessage = UIMessage<
  MessageMetadata,
  WargameDataParts,
  WargameTools
>;

type MessageRow = Tables<"messages">;

/**
 * Project the canonical `UIMessage` jsonb off a `messages` row. The
 * DB trigger (`messages_sync_uimessage_trg`) guarantees `message` is
 * populated whenever the row exists, so we treat it as non-nullable
 * here. Returns `null` only for a defensive guard against rows
 * predating the migration that somehow escaped backfill.
 */
export function messageRowToUIMessage(
  row: MessageRow,
): WargameUIMessage | null {
  if (row.message == null) return null;
  return row.message as unknown as WargameUIMessage;
}

/**
 * Helper for batch reads — drops any row whose `message` is unset
 * (shouldn't happen post-backfill) so callers get a clean
 * `WargameUIMessage[]`.
 */
export function messageRowsToUIMessages(
  rows: ReadonlyArray<MessageRow>,
): WargameUIMessage[] {
  const out: WargameUIMessage[] = [];
  for (const row of rows) {
    const ui = messageRowToUIMessage(row);
    if (ui) out.push(ui);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Part accessors — derived display fields for the renderer.
// ---------------------------------------------------------------------------

/** First `data-turn` part on the message, if any. The chat route
 *  emits exactly one at the start of every turn. */
export function getTurnMeta(m: WargameUIMessage): TurnDataPart | null {
  for (const p of m.parts) {
    if (p.type === "data-turn") return p.data;
  }
  return null;
}

/** Joined text across all `text` parts (there is usually just one). */
export function getText(m: WargameUIMessage): string {
  let out = "";
  for (const p of m.parts) {
    if (p.type === "text") out += p.text;
  }
  return out;
}

/** Joined reasoning across `reasoning` parts, separated like the
 *  legacy live-row formatter did for multi-step traces. */
export function getReasoning(m: WargameUIMessage): string {
  const parts: string[] = [];
  for (const p of m.parts) {
    if (p.type === "reasoning" && p.text.length > 0) parts.push(p.text);
  }
  return parts.join("\n\n<br/>\n\n");
}

// ProposalToolCall is the discriminated union the renderer already
// consumes via `ProposalLink`. We rebuild it from the typed tool part
// so callers don't need to know about per-state shapes.
import type { ProposalToolCall, ReviewOutput } from "@wargame-esq/agents";

/** The first negotiation tool call on the message, if its input has
 *  finished streaming. Returns null while the part is still in
 *  `input-streaming` state — the renderer can hide or skeleton the
 *  artifact until the input is fully arrived. */
export function getProposalToolCall(
  m: WargameUIMessage,
): ProposalToolCall | null {
  for (const p of m.parts) {
    if (p.type === "tool-propose_clause_edit") {
      if (p.state === "input-available" || p.state === "output-available") {
        return {
          name: "propose_clause_edit",
          clauseLanguage: p.input.clauseLanguage,
          rationale: p.input.rationale,
        };
      }
    }
    if (p.type === "tool-accept_proposal") {
      if (p.state === "input-available" || p.state === "output-available") {
        return {
          name: "accept_proposal",
          clauseLanguage: p.input.clauseLanguage,
        };
      }
    }
    if (p.type === "tool-mark_impasse") {
      if (p.state === "input-available" || p.state === "output-available") {
        return { name: "mark_impasse", reason: p.input.reason };
      }
    }
  }
  return null;
}

/** The submitted review payload, once `submit_review` finishes
 *  streaming. */
export function getReviewSubmission(m: WargameUIMessage): ReviewOutput | null {
  for (const p of m.parts) {
    if (p.type === "tool-submit_review") {
      if (p.state === "input-available" || p.state === "output-available") {
        return p.input as ReviewOutput;
      }
    }
  }
  return null;
}

/** Convenience accessors over `metadata`. They fall back to
 *  `data-turn` for legacy rows that pre-date `metadata` plumbing. */
export function getAgent(m: WargameUIMessage): "blue" | "red" | "system" {
  if (m.metadata?.agent) return m.metadata.agent;
  const meta = getTurnMeta(m);
  if (meta && meta.side !== "neutral") return meta.side;
  return "system";
}

export function getDbRole(
  m: WargameUIMessage,
): MessageMetadata["dbRole"] | null {
  if (m.metadata?.dbRole) return m.metadata.dbRole;
  const meta = getTurnMeta(m);
  if (meta && (meta.kind === "review" || meta.kind === "argument")) {
    return meta.kind;
  }
  return null;
}

export function getIssueId(m: WargameUIMessage): string | null {
  if (m.metadata?.issueId !== undefined) return m.metadata.issueId;
  const meta = getTurnMeta(m);
  if (meta && meta.kind === "argument") return meta.issueId;
  return null;
}

export function getCreatedMs(m: WargameUIMessage): number {
  return m.metadata?.createdAt ?? Date.now();
}

export function getCompletedMs(m: WargameUIMessage): number | null {
  return m.metadata?.completedAt ?? null;
}

/** Approximate "spent" duration for a finished message; 0 when the
 *  message has no completedAt yet (i.e. still streaming). */
export function getStaticDurationMs(m: WargameUIMessage): number {
  const completed = getCompletedMs(m);
  if (completed === null) return 0;
  return Math.max(0, completed - getCreatedMs(m));
}
