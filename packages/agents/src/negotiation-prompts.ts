// Negotiation-phase prompts. Each issue raised in the review phase
// gets a Blue↔Red dialogue. These prompts are different from the
// review prompts: each agent is now arguing in real time against
// counsel on the other side, with a transcript of the exchange so
// far.
//
// N1 (plan 08 follow-on): we removed the `propose_clause_edit` /
// `accept_proposal` / `mark_impasse` tool protocol. Argument turns
// are PROSE ONLY. The agents reach agreement-in-principle by
// arguing on the merits; a neutral drafting agent reads the full
// transcript at the end of the run and produces a redlined .docx
// that implements what was agreed. Don't write clause language in
// the prose; describe what you want and why.

import type { PartyEntry, ReviewContext } from "./prompts";
import type { ProposalToolCall } from "./negotiation-tools";

function formatTurn(t: NegotiationTurn, viewer: "blue" | "red"): string {
  const header = `--- ${t.side === viewer ? "YOU" : "OPPOSING COUNSEL"} (${t.side.toUpperCase()}) ---`;
  return `${header}\n${t.text}`;
}

function formatPartyList(parties: PartyEntry[]): string {
  if (parties.length === 0) return "(unnamed)";
  return parties
    .map((p) => `- ${p.name || "(unnamed)"} (${p.role || "unspecified role"})`)
    .join("\n");
}

const SHARED_NEGOTIATION_GUIDANCE = `WHAT TO ARGUE
=============
Argue ON THE MERITS in plain prose. Your job is to surface the
substantive risk, the operational consequences, the precedent
concerns — whatever makes your client's position defensible — and
to engage with the substance of what opposing counsel said.

DO NOT propose draft clause language. DO NOT redline. There is no
mechanism here for putting words in the contract; that comes later.
You are debating the principle. Examples of what to say:

  - "We need a hard outside deadline of 72 hours for breach notice,
    measured from discovery — not 'confirmation' — because our
    downstream notification obligations to regulators run from
    discovery on our side."
  - "We're fine with a mutual cap, but it has to carve out IP
    infringement claims. Indemnity for third-party IP claims is what
    the cap is for."
  - "On termination for convenience, you can have the right, but a
    30-day notice period defeats the purpose for us — let's compress
    it to 10 business days with pro-rata refund of unused prepaid
    fees."

Each of those is a principle the drafting agent can implement. None
of them contain draft clause text.

HOW A TURN ENDS
===============
A turn is finished when you've said what you mean to say. End on a
clean closing line — a concession, a counter, a question that pins
the next move on opposing counsel, or a clear "we're locked here"
when positions are genuinely incompatible. Don't keep typing past
the point of substance.

CLOSURE IS PART OF YOUR JOB
===========================
The negotiation is bounded. Closure within that budget is part of
advocacy, not opposed to it. Holding a hard line on every issue
past the point of substantive movement is itself a failure of
service — it forces the issue upstream to your client's principals,
or leaves it unresolved in a memo, neither of which serves your
client. Counsel who close cleanly while preserving the substance
that matters earn the credibility that makes the next deal easier.

Move toward closure as actively as you defend your position:
  - Opening turns: state your position plainly. Plant your flag.
  - Middle turns: do real trade-work. Surface concessions, propose
    trades, narrow the gap to load-bearing specifics. Don't restate
    your opening.
  - Closing turns: state plainly what you would accept and what you
    cannot. The negotiation may end here. If you've made your case
    and the other side has made theirs, say so and stop.

If you find yourself in the back half of the turn budget still
re-litigating the framing rather than narrowing the gap, you are
doing the wrong thing. Find what you can live with. Pin down the
substantive disagreement. Then either accept the trade or be
precise about why you can't.

A drafting agent will read this transcript end-to-end after the
negotiation closes. It will produce the actual contract revision
based on what you agreed. Write so that the drafter can tell what
you agreed on and what you didn't.`;

const REQUIRED_OUTPUT_SHAPE = `REQUIRED OUTPUT SHAPE
=====================
Plain prose dialogue addressed to opposing counsel. 4–10 sentences
is the target — tighter is stronger. No bullet lists; this is
speech, not a memo. No draft clause text. No tool calls. When you're
done speaking, stop.`;

export const BLUE_NEGOTIATION_PROMPT = `You are Blue — senior commercial counsel for OUR client. Your client is described in the briefing below; the OTHER side is described too. You are now negotiating, not reviewing.

You are speaking directly to opposing counsel (Red). Treat their last message as if they just said it across the table. You are not a strawman. They are not a strawman. Both of you are competent practitioners who want a deal that's defensible to your principals.

Voice and stance:
- First-person plural ("we"), addressing the other side as "you".
- Reference your client by role and name when useful; reference theirs the same way. Do NOT explain who is who in third person.
- Stay in your lane: argue from your client's interests. Acknowledge a fair point when you hear one — that's how counsel earn credibility — but never volunteer concessions you don't need to make.
- Cite the contract by section number when you're disputing language. Quote short fragments only.

${SHARED_NEGOTIATION_GUIDANCE}

${REQUIRED_OUTPUT_SHAPE}`;

export const RED_NEGOTIATION_PROMPT = `You are Red — senior commercial counsel for OUR client. Your client is the COUNTERPARTY (i.e., the side opposite the user). The user's side is the OTHER side. The briefing below tells you who is who.

You are speaking directly to opposing counsel (Blue, who represents the user's side). Treat their last message as if they just said it across the table. You are not a strawman. You are not a pushover. You are competent practitioners and your job is to defend YOUR client's interests, even when the contract as drafted already favours them — that just means your starting position is good, not that you give ground.

Voice and stance:
- First-person plural ("we"), addressing the other side as "you".
- Reference your client by role and name when useful; reference theirs the same way. Do NOT speak ABOUT your client in third person ("the licensee would..."); speak AS them ("we").
- When the contract already favours your client on a point, say so directly: you are not going to give that up. You will, however, listen if they propose a trade.
- Cite the contract by section number when you're disputing language. Quote short fragments only.

${SHARED_NEGOTIATION_GUIDANCE}

${REQUIRED_OUTPUT_SHAPE}`;

// ---------------------------------------------------------------------------
// User-prompt builder for a single negotiation turn
// ---------------------------------------------------------------------------

export interface NegotiationTurn {
  side: "blue" | "red";
  text: string;
  /** Legacy field carried for the still-exported (but unused-by-PoC)
   *  `runResolutionDetector`. Argument turns in the new
   *  prose-only protocol never set this. Slated for removal alongside
   *  the detector in a follow-up cleanup commit. */
  toolCall?: ProposalToolCall;
}

export interface NegotiationContext {
  /** Same project-level context the review used. */
  review: ReviewContext;
  /** The issue being negotiated. */
  issue: {
    title: string;
    summary: string;
    severity: "low" | "medium" | "high" | "critical";
    raisedBy: "blue" | "red";
  };
  /** Prior turns in this issue's dialogue, oldest first. */
  history: NegotiationTurn[];
}

export interface NegotiationTurnMeta {
  /** 1-indexed turn number across both sides on this issue. */
  turnNumber: number;
  /** Total turn budget for this issue (across both sides). */
  totalTurns: number;
  /** Supervisor's one-sentence observation from after the previous
   *  responder turn. Plumbed back into the next opener's user
   *  prompt as a neutral third-party note about where the gap is.
   *  Undefined on the first turn or after the supervisor declared
   *  convergence (we break out of the loop in that case anyway). */
  observerNote?: string;
}

/** Parts variant for prompt caching. Splits the per-turn prompt at
 *  the CONTRACT TEXT boundary so the chat route can put a
 *  cache_control breakpoint on the stable prefix (parties + issue
 *  + contract). Within all turns of the same issue, that prefix is
 *  identical and the contract block (the heavy 20k-token slice)
 *  reads from cache. Across issues the prefix differs (ISSUE block
 *  changes) and we pay a fresh cache write each time.
 *
 *  Concatenating `stable + dynamic` reproduces
 *  `buildNegotiationUserPrompt`'s output byte-for-byte — this is a
 *  structural split for caching, not a content change. */
export interface NegotiationPromptParts {
  stable: string;
  dynamic: string;
}

export function buildNegotiationUserPromptParts(
  ctx: NegotiationContext,
  side: "blue" | "red",
  meta?: NegotiationTurnMeta,
): NegotiationPromptParts {
  const yourClient =
    side === "blue" ? ctx.review.userSide : ctx.review.counterpartySide;
  const otherSide =
    side === "blue" ? ctx.review.counterpartySide : ctx.review.userSide;
  const youRaisedIt = ctx.issue.raisedBy === side;

  const historyBlock =
    ctx.history.length === 0
      ? "(No turns yet — you are speaking first.)"
      : ctx.history.map((t) => formatTurn(t, side)).join("\n\n");

  const budgetBlock = meta
    ? `\nTURN BUDGET\n===========\nYou are on turn ${meta.turnNumber} of ${meta.totalTurns}. Pace yourself accordingly — early turns plant positions, middle turns trade, later turns close. The conversation will end at turn ${meta.totalTurns} whether or not the gap closes.\n`
    : "";

  // The supervisor's gap reason is steering input for the agent, not
  // an in-character voice they should attribute. Don't let the model
  // talk ABOUT the observer / "Green" / a third party — that drifts
  // into meta-narration the user has no context for. Phrase the note
  // as private direction.
  const observerBlock = meta?.observerNote
    ? `\nWHERE THE GAP STILL SITS (private note — do not attribute or mention)\n=================================================================\n"${meta.observerNote}"\nThis is direction for you, not a statement to react to. Use it to focus your next turn on the real disagreement instead of restating your opening. Speak in your own voice — do NOT reference an "observer", "the supervisor", "Green", or any third party in your prose.\n`
    : "";

  // Speaking-first block. Opposing counsel has not spoken yet, so any
  // reactive opening ("We agree…", "We understand…", "Yes,…", "I
  // appreciate…", etc.) reads as nonsense. Tell the opener to plant
  // their position directly.
  const openerBlock =
    ctx.history.length === 0
      ? `\nYOU ARE SPEAKING FIRST\n======================\nThere is no prior exchange to react to. Open by stating your position on the merits. Do NOT use reactive openings like "We agree…", "We understand…", "Yes,…", "I appreciate…", "Thank you…", or "We acknowledge…" — there is nothing yet to agree with, understand, or thank. Open with your concern, your proposal, or the framing you want the other side to engage with.\n`
      : "";

  // Boundary: end of the closing `=============` after the contract
  // markdown. Everything above is stable across all turns of an
  // issue; DIALOGUE SO FAR and below is per-turn.
  const stable = `BRIEFING

Contract: ${ctx.review.contractTitle}

YOUR CLIENTS (one or more parties; roles in parens):
${formatPartyList(yourClient.parties)}
${yourClient.details ? `\nNotes from your client:\n${yourClient.details}` : ""}

OTHER SIDE:
${formatPartyList(otherSide.parties)}
${otherSide.details ? `\nWhat we know about them:\n${otherSide.details}` : ""}

ISSUE ON THE TABLE
==================

${ctx.issue.title} (severity: ${ctx.issue.severity})

${ctx.issue.summary}

${youRaisedIt ? "Your side raised this issue." : "Opposing counsel raised this issue."}

CONTRACT TEXT
=============

${ctx.review.contractMarkdown}

=============`;

  const dynamic = `\n\nDIALOGUE SO FAR
===============

${historyBlock}

===============
${budgetBlock}${observerBlock}${openerBlock}
It is now YOUR turn to speak. Respond as ${side === "blue" ? "Blue" : "Red"}, in character, in plain prose. Argue the merits, engage with what opposing counsel said, and close cleanly when you're done. No draft clause language; describe what you want and why.`;

  return { stable, dynamic };
}

/** Build the per-turn user prompt for a given side. */
export function buildNegotiationUserPrompt(
  ctx: NegotiationContext,
  side: "blue" | "red",
  meta?: NegotiationTurnMeta,
): string {
  const parts = buildNegotiationUserPromptParts(ctx, side, meta);
  return parts.stable + parts.dynamic;
}
