import type { NegotiationContext } from "./negotiation-prompts";

/**
 * Resolution detection. Called between turns to decide if the
 * exchange has concluded. Pure code — no LLM call. Each turn ends
 * with a structured tool call (or no tool call for CONTINUE), so
 * "did we reach agreement?" is a discriminated-union check, not a
 * judgment call.
 *
 * Earlier this ran an LLM detector against a synthesized transcript.
 * It produced false positives where two competing proposals "looked
 * close" and the model called agreement without anyone actually
 * having invoked accept_proposal. Issue closing prematurely is
 * worse than running an extra turn — strict signal beats heuristic.
 *
 * Rules:
 *   - Most recent turn is `accept_proposal` → AGREE on that text.
 *   - Both sides' most recent turns are `mark_impasse` → IMPASSE.
 *   - Anything else → CONTINUE (let the per-side turn cap end the
 *     loop with `unresolved` if neither side ever locks in).
 *
 * No more `escalate` outcome — the workflow has no business-decision
 * branch wired up, so there's nothing to do with that classification.
 */

export type ResolutionOutcome =
  | { kind: "continue"; rationale: string }
  | { kind: "agree"; clauseLanguage: string }
  | { kind: "impasse"; impasseSummary: string };

export interface RunResolutionDetectorResult {
  outcome: ResolutionOutcome;
  /**
   * Token usage. Always zero now — kept on the type for ABI
   * compatibility with the workflow's `recordUsage` call. Detector
   * runs free.
   */
  usage: { inputTokens: number; outputTokens: number };
}

export interface RunResolutionDetectorInput {
  context: NegotiationContext;
}

export function runResolutionDetector({
  context,
}: RunResolutionDetectorInput): RunResolutionDetectorResult {
  const usage = { inputTokens: 0, outputTokens: 0 };
  const history = context.history;
  if (history.length === 0) {
    return {
      outcome: { kind: "continue", rationale: "No turns yet." },
      usage,
    };
  }

  const last = history[history.length - 1];
  if (!last) {
    return {
      outcome: { kind: "continue", rationale: "No turns yet." },
      usage,
    };
  }

  // Acceptance is the only path to agreement. The accepting side
  // quoted the proposal back via the tool, so the clause text is
  // already canonical. No semantic comparison needed.
  if (last.toolCall?.name === "accept_proposal") {
    return {
      outcome: {
        kind: "agree",
        clauseLanguage: last.toolCall.clauseLanguage,
      },
      usage,
    };
  }

  // Two-sided impasse: both sides' most recent turn is a
  // `mark_impasse`. Single-sided impasse doesn't trigger — the
  // other side might still find a path. We concatenate both
  // reasons for the resolution record.
  const recentByside = (side: "blue" | "red") => {
    for (let i = history.length - 1; i >= 0; i--) {
      const turn = history[i];
      if (turn && turn.side === side) return turn;
    }
    return undefined;
  };
  const recentBlue = recentByside("blue");
  const recentRed = recentByside("red");
  if (
    recentBlue?.toolCall?.name === "mark_impasse" &&
    recentRed?.toolCall?.name === "mark_impasse"
  ) {
    return {
      outcome: {
        kind: "impasse",
        impasseSummary: `Blue: ${recentBlue.toolCall.reason} | Red: ${recentRed.toolCall.reason}`,
      },
      usage,
    };
  }

  return {
    outcome: {
      kind: "continue",
      rationale: "Awaiting accept_proposal or mutual impasse.",
    },
    usage,
  };
}
