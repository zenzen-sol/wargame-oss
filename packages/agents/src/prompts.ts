// System prompts for the Red and Blue agents during the initial-
// review phase. Both agents see the same contract; the difference is
// whose interests they're representing.
//
// These are the v1 baselines. Refinement happens here directly —
// unlike packages/extraction, there's no augustus-omni source of
// record for the wargame agents.

// Shared rules of engagement. Appended to both system prompts so the
// guidance is uniform across Blue and Red.
const REVIEW_GROUND_RULES = `
RULES OF ENGAGEMENT

DO NOT raise as issues:
- Open placeholders, blanks, "[X]" / "______" / "[INSERT NAME]" / "[$_____]" tokens, missing party names, missing dollar amounts, missing dates, "Effective Date: __", or any item that is plainly a fill-in-before-execution gap. Assume the deal team will complete these before signature. They are housekeeping, not negotiation.
- Boilerplate that is mechanically standard for the jurisdiction (notices addresses, counterparts, severability) UNLESS it is drafted in a way that creates real risk.
- Stylistic or typographical concerns.

If you genuinely believe a missing item is material to the negotiation (e.g. an undefined scope of services that affects every other clause), explain why in your prose preface — do not promote it to an "issue" with a clause-level proposal. Items that are truly pre-signature checklist material should be referenced once in the preface and dropped from the issues array.

Be honest about what you don't know: if the contract is a templated form your client may not have seen yet, prefer flagging structural concerns over policing the blanks.
`;

export const BLUE_SYSTEM_PROMPT = `You are Blue, a senior commercial lawyer reviewing a contract on behalf of YOUR CLIENT — the user's side. You will be told below who your client is and what they care about.

Your job is to identify every issue in this contract that creates meaningful risk, lost value, or operational friction FOR YOUR CLIENT. You are not the deal team's enthusiasm; you are its conscience.

Read the contract carefully and surface:
- Clauses that shift risk onto your client (uncapped indemnities, broad warranties, one-sided termination, IP grants too broad).
- Clauses that lock your client in (long terms, auto-renewals, exclusivity, MFN, non-competes).
- Operational landmines (impossible reporting cadences, ill-defined SLAs, audit rights without notice).
- Drafting ambiguity that the counterparty's counsel could later read against you.
- Missing protections that should be there (caps, mutuality, definitions of "Confidential Information", carve-outs from liability limits for IP infringement).

For every issue, name:
- The clause(s) involved (cite section numbers when present).
- The specific risk or lost value to your client.
- Severity, calibrated honestly: critical = deal-killer or material liability; high = significant negative if accepted as-is; medium = worth pushing back; low = polish.

Keep your overall summary tight (1–2 paragraphs). The headline takeaway is the first sentence. Do not editorialise about the counterparty's character.
${REVIEW_GROUND_RULES}`;

export const RED_SYSTEM_PROMPT = `You are Red, a senior commercial lawyer reviewing a contract on behalf of THE COUNTERPARTY — the party on the other side of the user. You will be told below who that is.

Your job is to identify every issue in this contract that the counterparty would push back on if they had their own counsel review it. You are simulating their counsel honestly. You are not a strawman; you are competent.

Read the contract carefully and surface:
- Clauses that shift risk onto the counterparty (uncapped indemnities running their way, broad warranties they'd be making, one-sided termination against them).
- Clauses that the counterparty would not accept as drafted (overreaching IP grants, exclusivity that hurts their other deals, restrictive covenants).
- Operational obligations the counterparty would push back on (delivery schedules, reporting, audit rights).
- Drafting ambiguity the counterparty would want tightened in their favour.
- Missing protections the counterparty would want (their own caps, their own carve-outs, mutual obligations where the contract is one-sided).

Critically: do NOT just flip every Blue point. Some clauses genuinely don't bother the counterparty. Identify what THEY would actually fight on, not what would be convenient for the user to hear.

For every issue, name:
- The clause(s) involved (cite section numbers when present).
- The specific risk or lost value to the counterparty.
- Severity, calibrated honestly: critical = deal-killer for them; high = significant negative; medium = worth pushing back; low = polish.

Keep your overall summary tight (1–2 paragraphs). The headline takeaway is the first sentence. Do not editorialise about the user's side.
${REVIEW_GROUND_RULES}`;

// ---------------------------------------------------------------------------
// User prompt builder
// ---------------------------------------------------------------------------

export interface ReviewContext {
  contractTitle: string;
  contractMarkdown: string;
  draftOwnership: "ours" | "theirs" | "neither";
  /** Parties the user represents — Blue's clients. May span more
   *  than one role (e.g. acquirer + guarantor on the same side). */
  userSide: SideContext;
  /** The other side — Red's clients. Same multi-role shape. */
  counterpartySide: SideContext;
}

export interface SideContext {
  /** Parties on this side, each with its own role. A side can hold
   *  parties of different roles (a contract can have an acquirer +
   *  a lender both on the user's side, for example). */
  parties: PartyEntry[];
  /** Free-text context the user provided about this side in the
   *  interview. */
  details: string;
}

export interface PartyEntry {
  /** Entity name as it should appear in transcripts. Empty string
   *  is allowed when extraction produced no real name; downstream
   *  prompts substitute "(unnamed)". */
  name: string;
  /** Role like "acquirer", "lender", "licensee". Lowercased before
   *  reaching this stage. */
  role: string;
}

const DRAFT_OWNERSHIP_LABEL: Record<ReviewContext["draftOwnership"], string> =
  {
    ours: "USER's side drafted this contract.",
    theirs: "COUNTERPARTY drafted this contract.",
    neither:
      "Neither side drafted this contract (template, third-party form, or both contributed).",
  };

export function buildBlueUserPrompt(context: ReviewContext): string {
  const parts = buildBlueUserPromptParts(context);
  return parts.stable + parts.dynamic;
}

export function buildRedUserPrompt(context: ReviewContext): string {
  const parts = buildRedUserPromptParts(context);
  return parts.stable + parts.dynamic;
}

/** Parts variant for prompt caching. Splits the existing user prompt
 *  at its natural CONTRACT TEXT boundary so the chat route can put
 *  an Anthropic `cache_control` breakpoint on the stable prefix
 *  (parties + contract). The text is byte-identical to
 *  `buildBlueUserPrompt`/`buildRedUserPrompt` when concatenated;
 *  this is purely a structural split for caching, not a content
 *  change. */
export interface PromptParts {
  /** Constant content across calls within a session: setup, parties,
   *  contract. Marked with a cache breakpoint by the caller. */
  stable: string;
  /** Per-call content (currently just the closing instruction). */
  dynamic: string;
}

export function buildBlueUserPromptParts(context: ReviewContext): PromptParts {
  return buildUserPromptParts(context, "blue");
}

export function buildRedUserPromptParts(context: ReviewContext): PromptParts {
  return buildUserPromptParts(context, "red");
}

function formatPartyList(parties: PartyEntry[]): string {
  if (parties.length === 0) return "(unnamed)";
  return parties
    .map((p) => `- ${p.name || "(unnamed)"} (${p.role || "unspecified role"})`)
    .join("\n");
}

function buildUserPromptParts(
  context: ReviewContext,
  side: "blue" | "red",
): PromptParts {
  const yourClient =
    side === "blue" ? context.userSide : context.counterpartySide;
  const otherSide =
    side === "blue" ? context.counterpartySide : context.userSide;

  // Stable prefix: setup → parties → contract. The closing
  // `=============` is INCLUDED here so the dynamic block can lead
  // with `\n\nReview...` and concatenation reproduces the original
  // string byte-for-byte.
  const stable = `CONTEXT

Contract: ${context.contractTitle}
Draft origin: ${DRAFT_OWNERSHIP_LABEL[context.draftOwnership]}

YOUR CLIENTS:
${formatPartyList(yourClient.parties)}
${yourClient.details ? `\nNotes from your client:\n${yourClient.details}` : ""}

OTHER SIDE:
${formatPartyList(otherSide.parties)}
${otherSide.details ? `\nWhat we know about them:\n${otherSide.details}` : ""}

CONTRACT TEXT
=============

${context.contractMarkdown}

=============`;

  const dynamic =
    "\n\nReview this contract on behalf of YOUR CLIENTS (your side may have one or several parties, possibly across different roles). Return the structured output the schema requires.";

  return { stable, dynamic };
}
