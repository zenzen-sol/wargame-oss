// Provider catalog and tier defaults. Single source of truth for
// which providers we support, which models each one offers, and the
// per-tier defaults. Mirrors augustus-omni's lib/settings.ts so the
// patterns stay aligned across the two products. When we add a
// settings UI later, this is what it picks from.
//
// Tiers:
//   - "low"      — extraction, resolution detector. Cheap-and-fast.
//   - "baseline" — review, negotiation arguments. Reasoning-grade.
//   - "drafter"  — end-of-run anchored-edits pipeline. Needs precise
//                  substring matching against the original document;
//                  weak models routinely emit unmatchable `find`
//                  strings and the redline compiles to zero applied
//                  edits. On Anthropic this is Sonnet (Haiku 4.5
//                  shipped a bunch of 0-applied runs); on OpenAI
//                  gpt-5.4-mini holds up fine.

export type Provider = "openai" | "anthropic";

export type ModelTier = "low" | "baseline" | "drafter";

/** Relative cost indicator shown next to model options. Same scale as augustus-omni. */
export type ModelCostTier = "$" | "$$" | "$$$" | "$$$$";

export interface ModelOption {
  value: string;
  label: string;
  costTier?: ModelCostTier;
}

export const PROVIDER_LABELS: Record<Provider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
};

/**
 * Per-provider model catalog. Sourced from
 * augustus-omni/apps/local/lib/settings.ts so the model strings stay
 * canonical across products. Add a new entry here to expose a model
 * to a future settings UI; `resolveModelId` validates user-supplied
 * IDs against this list.
 */
export const MODEL_OPTIONS: Record<Provider, ModelOption[]> = {
  openai: [
    { value: "gpt-5.5", label: "GPT-5.5", costTier: "$$$$" },
    { value: "gpt-5.4", label: "GPT-5.4", costTier: "$$$" },
    { value: "gpt-5.4-mini", label: "GPT-5.4 Mini", costTier: "$" },
    { value: "gpt-5.4-nano", label: "GPT-5.4 Nano", costTier: "$" },
  ],
  anthropic: [
    { value: "claude-opus-4-7", label: "Claude Opus 4.7", costTier: "$$$" },
    {
      value: "claude-sonnet-4-6",
      label: "Claude Sonnet 4.6",
      costTier: "$$$",
    },
    {
      value: "claude-haiku-4-5-20251001",
      label: "Claude Haiku 4.5",
      costTier: "$$",
    },
  ],
};

/**
 * Per-provider default model IDs. Picked to keep cost low by default
 * while still being capable enough for the agent loop's prompts.
 */
export const DEFAULT_MODELS: Record<Provider, Record<ModelTier, string>> = {
  openai: {
    low: "gpt-5.4-nano",
    baseline: "gpt-5.4-mini",
    // Mini handles the anchored-edits protocol cleanly in practice;
    // no need to escalate.
    drafter: "gpt-5.4-mini",
  },
  anthropic: {
    low: "claude-haiku-4-5-20251001",
    baseline: "claude-haiku-4-5-20251001",
    // Sonnet for the drafter — Haiku 4.5 has been emitting `find`
    // strings that don't match the document text exactly, producing
    // redlines with 0 applied / N errored. Sonnet's precision on
    // structured-edit tasks is materially better and worth the
    // single-call cost bump.
    drafter: "claude-sonnet-4-6",
  },
};

/**
 * Validate `modelId` against the provider's catalog. Returns it
 * unchanged if it matches; otherwise falls back to the per-tier
 * default. Mirrors augustus-omni's `resolveModelId` so a typo or a
 * stale env value can never crash the workflow at request time —
 * worst case, we silently land on the safe default.
 */
export function resolveModelId(
  provider: Provider,
  tier: ModelTier,
  modelId: string | undefined,
): string {
  if (!modelId) return DEFAULT_MODELS[provider][tier];
  const valid = MODEL_OPTIONS[provider].some((o) => o.value === modelId);
  return valid ? modelId : DEFAULT_MODELS[provider][tier];
}

/** Whether the provider needs an API key. (No keyless providers yet.) */
export function providerRequiresApiKey(_provider: Provider): boolean {
  return true;
}

export function isProvider(value: unknown): value is Provider {
  return value === "openai" || value === "anthropic";
}
