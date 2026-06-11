// Negotiation supervisor — between-turn convergence detector.
//
// The Blue/Red agents argue on the merits in prose only. After each
// responder turn (i.e. after both sides have had equal numbers of
// turns on an issue), the supervisor reads the dialogue and decides
// whether they have reached a workable agreement-in-principle.
//
// If converged: the writer loop breaks the per-issue loop and the
// `brief` is persisted as a `data-resolution` part on the run
// message. The end-of-run Drafter agent will consume these briefs
// when generating the redline.
//
// If not converged: the writer loop continues. The hard cap on
// turns per issue remains as the backstop.
//
// The supervisor never speaks to the agents. They don't know it
// exists. Convergence is judged from prose alone — no tool calls,
// no symbol-equality lock-in, no shared schema between the agents
// and the supervisor.

import { generateObject } from "ai";
import { z } from "zod";
import type { NegotiationContext, NegotiationTurn } from "./negotiation-prompts";
import { resolveModelForTier } from "./runtime";

export const placeholderSchema = z.object({
  key: z
    .string()
    .min(1)
    .describe(
      "Short snake_case identifier for this open decision (e.g. 'chronic_failure_threshold', 'notice_period_days'). Used so downstream tools can refer back to it.",
    ),
  description: z
    .string()
    .min(1)
    .describe(
      "One sentence in plain prose describing the specific value or choice the human needs to make.",
    ),
  bluePosition: z
    .string()
    .nullable()
    .describe(
      "Blue's last stated preference for this value, if discernible from the dialogue. Null if Blue never committed to a specific number/value/option.",
    ),
  redPosition: z
    .string()
    .nullable()
    .describe(
      "Red's last stated preference for this value, if discernible from the dialogue. Null if Red never committed to a specific number/value/option.",
    ),
});

export const supervisorSchema = z.object({
  converged: z
    .boolean()
    .describe(
      "True only if the two sides have reached a workable, substantive agreement on the POLICY of this issue. Be conservative: politeness, partial acknowledgment, or movement-in-progress is NOT convergence. Convergence on structure with one or more specific values still pending counts as converged — list the open values in `placeholders`.",
    ),
  reason: z
    .string()
    .min(1)
    .describe(
      "One sentence. If converged: what indicates substantive agreement. If not converged: what policy-level gap remains. (If only specific values are open, that's converged-with-placeholders, not non-converged.)",
    ),
  brief: z
    .string()
    .nullable()
    .describe(
      "Null when converged is false. When converged is true: 2–4 sentences describing what a neutral drafter should implement on the AGREED structure. Refer to any open values by their placeholder `key`. Do NOT write clause language; describe the policy at the directive level.",
    ),
  placeholders: z
    .array(placeholderSchema)
    .nullable()
    .describe(
      "Null or empty when the agreement is clean. Non-empty when the two sides agreed on structure but left one or more specific values open (e.g. a numerical threshold, a notice period, a list of named items). Only use placeholders when (a) policy agreement is genuine and specifiable in the brief, and (b) the remaining open question is a concrete value being circled rather than a substantive policy disagreement. Do not use placeholders to gloss over policy disagreement.",
    ),
});

export type SupervisorVerdict = z.infer<typeof supervisorSchema>;
export type SupervisorPlaceholder = z.infer<typeof placeholderSchema>;

const SUPERVISOR_SYSTEM = `You are a senior, neutral commercial counsel observing a single-issue negotiation between Blue (representing one party) and Red (representing the other). Your job is to decide whether they have reached a workable agreement-in-principle on this specific issue.

You are NOT detecting:
- Politeness or acknowledgment without substantive movement.
- Soft conditional statements ("if you can live with X, then we have a path") without confirmation from the other side.
- Substantive policy disagreement disguised as a missing detail.

You ARE detecting:
- One side proposes a position and the other accepts it, even with minor wording-level caveats that don't change the substance.
- Both sides explicitly state the same substantive outcome they can live with.
- Structural agreement on what the clause should DO, even if specific numerical/categorical values remain open.

Be conservative. If you are not sure, return converged: false. A false negative costs us a few more turns of dialogue; a false positive locks in a non-agreement as if it were settled.

PLACEHOLDERS — when to use them
================================
Sometimes the agents agree on what a clause should do but circle around a specific value without naming it (a threshold, a notice period, a cap amount, a list of named exceptions). In that case, return converged: true AND list the open values in \`placeholders\`. The brief captures the agreed structure and refers to each placeholder by its \`key\`. The drafter will leave those positions marked for human decision.

Only use placeholders when BOTH:
  (a) The policy of the clause is genuinely agreed and specifiable in the brief — you can describe what the clause does without knowing the value.
  (b) The remaining open question is a concrete value the agents have been circling (a number, a duration, a specific list) rather than a real policy disagreement.

If you cannot write a clean brief without knowing the value, the agreement is NOT actually structural and you should return converged: false instead. Placeholders are NOT a way to gloss over policy disagreement.

Examples of clean briefs
========================
- "Hard outside breach-notice deadline of 72 hours, measured from discovery (not confirmation). Initial alert on discovery of a suspected Security Incident; fuller confirmed-incident notice once Supplier has facts. Forensic preservation and access to findings is required."
- "Liability cap is mutual, set at fees paid in the prior 12 months, with an uncapped carve-out for IP infringement and breaches of confidentiality obligations."

Example of a brief with a placeholder
=====================================
brief: "Service-level credits are the primary economic remedy for ordinary uptime misses. Termination for chronic failure is available when missed-availability events exceed the threshold defined by [chronic_failure_threshold]. Customer must give written notice and a cure period before terminating."
placeholders: [{
  key: "chronic_failure_threshold",
  description: "How many missed-availability events over what rolling window trigger Customer's right to terminate for chronic failure.",
  bluePosition: "two missed months in any rolling six-month window",
  redPosition: "three missed months consecutively, with prior notice and cure"
}]

Do NOT write clause language. Do NOT use "shall" or section-citation drafting.`;

function formatHistoryForSupervisor(history: NegotiationTurn[]): string {
  return history
    .map((t, i) => `--- TURN ${i + 1} · ${t.side.toUpperCase()} ---\n${t.text}`)
    .join("\n\n");
}

export interface RunSupervisorInput {
  ctx: NegotiationContext;
  signal?: AbortSignal;
  /** BYOK-resolved provider + key. Falls back to env if omitted. */
  llmCreds?: { provider: "openai" | "anthropic"; apiKey: string };
}

export async function runSupervisor(
  args: RunSupervisorInput,
): Promise<{
  verdict: SupervisorVerdict;
  modelId: string;
  usage: import("ai").LanguageModelUsage;
}> {
  const { ctx, signal, llmCreds } = args;
  const { model, modelId } = resolveModelForTier({
    tier: "baseline",
    provider: llmCreds?.provider,
    apiKey: llmCreds?.apiKey,
  });
  const prompt = `ISSUE
=====

${ctx.issue.title} (severity: ${ctx.issue.severity})

${ctx.issue.summary}

DIALOGUE
========

${formatHistoryForSupervisor(ctx.history)}

================

Has the negotiation reached a workable agreement-in-principle on this issue? Be conservative.`;

  const result = await generateObject({
    model,
    schema: supervisorSchema,
    system: SUPERVISOR_SYSTEM,
    prompt,
    abortSignal: signal,
    experimental_telemetry: {
      isEnabled: true,
      functionId: "supervisor",
      metadata: {
        issueId: ctx.issue.title,
        turns: ctx.history.length,
      },
    },
  });
  return { verdict: result.object, modelId, usage: result.usage };
}
