// Project state model — the discriminated union of UI scenes the
// project view can be in, plus a pure `deriveScene` that maps the
// raw project data onto exactly one scene.
//
// The point of this module is that every scene-driven decision in
// the UI flows from a single discriminated union. No scattered
// `status === "..."` checks, no parallel `showFiles` / `isTranscript`
// booleans recomputed from the same input. The renderer switches on
// `scene.kind` and the exhaustiveness check catches missing cases.

import {
  getAgent,
  getDbRole,
  getIssueId,
  messageRowToUIMessage,
} from "@/lib/ui-message";
import type { Tables } from "@/types/database.types";

type Project = Tables<"projects">;
type File = Tables<"files">;
type Party = Tables<"project_parties">;
type Message = Tables<"messages">;
type Issue = Tables<"issues">;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface SceneInput {
  project: Project;
  files: File[] | null;
  parties: Party[] | null;
  messages: Message[] | null;
  issues: Issue[] | null;
}

// ---------------------------------------------------------------------------
// Output: discriminated union of scenes
// ---------------------------------------------------------------------------

export type Scene =
  | {
      kind: "file-setup";
      project: Project;
      canStart: boolean;
      blockReason: string;
    }
  | { kind: "extracting"; project: Project }
  | {
      kind: "extraction-failed";
      project: Project;
      error: string;
    }
  | { kind: "setup"; project: Project }
  | {
      kind: "live";
      project: Project;
      phase: "reviewing" | "negotiating";
      issuesProgress: IssuesProgress;
      /** The issue currently being argued (status === "in_negotiation"),
       *  with its index (1-based) inside `issuesProgress.total`. Undefined
       *  during the reviewing phase or between issues. */
      currentIssue?: {
        title: string;
        index: number;
        total: number;
      };
    }
  | {
      kind: "live-failed";
      project: Project;
      error: string;
      /** Where the run was when it failed — same data as the live scene
       *  carried so the failure UI can say "failed during turn 3 on
       *  $issue" instead of just "failed." */
      issuesProgress: IssuesProgress;
      currentIssue?: { title: string; index: number; total: number };
    }
  | {
      kind: "completed";
      project: Project;
      outcome: "clean" | "with-impasses";
      issueStats: IssueStats;
    }
  | {
      // Stop was clicked. Terminal. Transcript stays visible if any
      // agent work landed; otherwise the body shows a small "Run
      // cancelled" card. Convex-era `cancelling` two-phase state was
      // dropped — `requestCancel` now flips straight to `cancelled`
      // and the chat route's signal-abort handles in-flight stream
      // teardown synchronously.
      kind: "cancelled";
      project: Project;
      hasTranscript: boolean;
    };

export interface IssuesProgress {
  /** Issues actually negotiated this run (`open` + `in_negotiation` + the resolved kinds, excluding `deferred`). */
  total: number;
  /** Of those, how many reached a non-deferred terminal state. */
  resolved: number;
  /** Issues raised but skipped because the run hit its cap. */
  deferred: number;
}

export interface IssueStats {
  agreed: number;
  escalated: number;
  impasse: number;
  deferred: number;
  /** Agents tried but hit the per-side turn cap without converging. */
  unresolved: number;
  /** Substantive agreement reached, but one or more concrete values
   *  were left for a human to decide. Status is still `"agreed"` in
   *  the DB; the resolution payload's `kind ===
   *  "agreed_with_placeholders"` distinguishes it from clean
   *  agreement. */
  pendingInput: number;
}

// Scenes that always want the full-height three-column transcript
// layout. `cancelled` is conditional — see `sceneUsesTranscript`.
export const TRANSCRIPT_SCENES: ReadonlySet<Scene["kind"]> = new Set([
  "live",
  "live-failed",
  "completed",
]);

/** True when the scene's body should render the three-column
 *  transcript. Captures the always-transcript scenes and the
 *  conditionally-transcript `cancelled` state. */
export function sceneUsesTranscript(scene: Scene): boolean {
  if (TRANSCRIPT_SCENES.has(scene.kind)) return true;
  if (scene.kind === "cancelled") return scene.hasTranscript;
  return false;
}

// ---------------------------------------------------------------------------
// Derive
// ---------------------------------------------------------------------------

const RESOLVED_ISSUE_STATUSES: ReadonlySet<Issue["status"]> = new Set([
  "agreed",
  "escalated",
  "impasse",
  "unresolved",
]);

/**
 * Identify the issue currently being negotiated, plus its position
 * in the run queue. The "queue" here is the deterministic order the
 * workflow walks: severity desc, ties broken by raise order. We
 * approximate it by sorting non-deferred issues the same way and
 * taking the first `in_negotiation` row's index.
 */
function computeCurrentIssue(
  issues: Issue[],
): { title: string; index: number; total: number } | undefined {
  const queue = issues.filter((i) => i.status !== "deferred");
  // Severity priority for the natural sort. Matches the workflow's
  // pickNextIssue ordering — kept inline rather than imported because
  // this is UI-side derivation and shouldn't reach into the workflow
  // package.
  const severityRank: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  const sorted = [...queue].sort((a, b) => {
    const sa = severityRank[a.severity] ?? 99;
    const sb = severityRank[b.severity] ?? 99;
    if (sa !== sb) return sa - sb;
    return a.created_at.localeCompare(b.created_at);
  });
  // Prefer the currently-arguing issue; fall back to the last
  // resolved one so the header subheading stays stable through the
  // gap between turns (one issue finishing → next picking up).
  let idx = sorted.findIndex((i) => i.status === "in_negotiation");
  if (idx === -1) {
    for (let i = sorted.length - 1; i >= 0; i--) {
      const candidate = sorted[i];
      if (candidate && RESOLVED_ISSUE_STATUSES.has(candidate.status)) {
        idx = i;
        break;
      }
    }
  }
  if (idx === -1) return undefined;
  const issue = sorted[idx];
  if (!issue) return undefined;
  return { title: issue.title, index: idx + 1, total: sorted.length };
}

/** Most recent argument message on a specific issue (or any issue).
 *  Reads `message` jsonb via the typed accessors. */
function findLastArgument(
  messages: Message[],
  issueId?: string,
): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    const ui = messageRowToUIMessage(m);
    if (!ui) continue;
    if (getDbRole(ui) !== "argument") continue;
    const agent = getAgent(ui);
    if (agent !== "blue" && agent !== "red") continue;
    if (issueId && getIssueId(ui) !== issueId) continue;
    return m;
  }
  return undefined;
}

function computeProgress(issues: Issue[]): IssuesProgress {
  let resolved = 0;
  let deferred = 0;
  let inFlight = 0;
  for (const i of issues) {
    if (i.status === "deferred") deferred++;
    else if (RESOLVED_ISSUE_STATUSES.has(i.status)) resolved++;
    else inFlight++;
  }
  return {
    // total = the issues this run actually planned to negotiate (i.e.
    // not deferred). The progress fraction `resolved / total` then
    // reflects work against the negotiation budget, not against every
    // issue ever raised.
    total: resolved + inFlight,
    resolved,
    deferred,
  };
}

function computeStats(issues: Issue[]): IssueStats {
  let agreed = 0;
  let escalated = 0;
  let impasse = 0;
  let deferred = 0;
  let unresolved = 0;
  let pendingInput = 0;
  for (const i of issues) {
    if (i.status === "agreed") {
      const r = i.resolution as { kind?: string } | null;
      if (r?.kind === "agreed_with_placeholders") pendingInput++;
      else agreed++;
    } else if (i.status === "escalated") escalated++;
    else if (i.status === "impasse") impasse++;
    else if (i.status === "deferred") deferred++;
    else if (i.status === "unresolved") unresolved++;
  }
  return { agreed, escalated, impasse, deferred, unresolved, pendingInput };
}

// Single source of truth for "is the project ready to extract?".
// Mirrors the three guards in lib/actions/extraction.ts so the button
// disabled state and the server response always agree.
function computeStartGate(files: File[]): {
  canStart: boolean;
  blockReason: string;
} {
  if (files.some((f) => f.conversion_status === "failed")) {
    return {
      canStart: false,
      blockReason: "One or more files failed to convert. Remove them or retry.",
    };
  }
  if (files.some((f) => f.conversion_status === "pending")) {
    return {
      canStart: false,
      blockReason: "Reading the file. One moment.",
    };
  }
  return {
    canStart: true,
    blockReason:
      "Reads each .docx, identifies the parties, then prompts you to confirm.",
  };
}

/**
 * Map project + related rows → exactly one scene. Pure. Server
 * component handles loading (Next.js `loading.tsx` Suspense) and
 * not-found (inline 404 in `page.tsx`) before this runs, so we
 * can require a non-null project.
 */
export function deriveScene(input: SceneInput): Scene {
  const { project, files, parties, messages, issues } = input;

  const filesList = files ?? [];
  const partiesList = parties ?? [];
  const messagesList = messages ?? [];
  const issuesList = issues ?? [];

  switch (project.status) {
    case "draft": {
      const gate = computeStartGate(filesList);
      return {
        kind: "file-setup",
        project,
        canStart: gate.canStart,
        blockReason: gate.blockReason,
      };
    }
    case "extracting":
      return { kind: "extracting", project };

    case "ready_for_interview":
    case "interviewing":
      // Both DB statuses map to the single-form setup scene.
      // `ready_for_interview` is the first-time-through entry;
      // `interviewing` means the user returned to revise. Same
      // form, same submit path — see `submitSetup`.
      return { kind: "setup", project };

    case "reviewing":
      return {
        kind: "live",
        project,
        phase: "reviewing",
        issuesProgress: computeProgress(issuesList),
      };

    case "negotiating": {
      const currentIssue = computeCurrentIssue(issuesList);
      return {
        kind: "live",
        project,
        phase: "negotiating",
        issuesProgress: computeProgress(issuesList),
        currentIssue,
      };
    }

    case "complete":
      return {
        kind: "completed",
        project,
        outcome: "clean",
        issueStats: computeStats(issuesList),
      };

    case "complete_with_impasses":
      return {
        kind: "completed",
        project,
        outcome: "with-impasses",
        issueStats: computeStats(issuesList),
      };

    case "failed": {
      const error = project.failure_message ?? "Unknown error.";
      // Branch on whether extraction got far enough to write parties.
      // Pre-parties = we never got past extraction → user should
      // retry-from-files. Post-parties = we lost work mid-run, but
      // confirmed parties + interview + any transcript are still
      // valid → don't offer a destructive retry.
      if (partiesList.length === 0) {
        return { kind: "extraction-failed", project, error };
      }
      const currentIssue = computeCurrentIssue(issuesList);
      return {
        kind: "live-failed",
        project,
        error,
        issuesProgress: computeProgress(issuesList),
        currentIssue,
      };
    }
    case "cancelling":
    case "cancelled":
      // The DB enum still has `cancelling` for migration safety; we
      // collapse both into the same UI state.
      return {
        kind: "cancelled",
        project,
        hasTranscript: messagesList.length > 0,
      };
    default: {
      const _exhaustive: never = project.status;
      throw new Error(`Unhandled project status: ${_exhaustive as string}`);
    }
  }
}
