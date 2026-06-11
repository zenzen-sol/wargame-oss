// Shared "resolve model + price" helpers. Workflows (server-
// orchestrated extraction) and the saas Edge routes (browser-
// orchestrated negotiation/review) both need the same model factory
// and pricing table; this file is the single source so they can't
// drift.
//
// BYOK note: post-BYOK, every production caller passes provider +
// apiKey explicitly (sourced from user_api_keys via the lib/byok.ts
// helper). The env-based fallback below is kept for dev scripts and
// experiments; in production it's a fallback only when the caller
// has done its own dev-bypass check upstream.

import type { LanguageModel } from "ai";
import {
  type ModelTier,
  type Provider,
  isProvider,
  providerRequiresApiKey,
  resolveModelId as resolveCanonicalModelId,
} from "./model-config";
import { getModel } from "./model-factory";

interface ModelPrice {
  /** USD per 1M input tokens. */
  in: number;
  /** USD per 1M output tokens. */
  out: number;
}

const PRICING: Record<string, ModelPrice> = {
  // OpenAI
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-5.4-nano": { in: 0.1, out: 0.4 },
  "gpt-5.4-mini": { in: 0.4, out: 1.6 },
  "gpt-5.4": { in: 2.5, out: 10 },
  "gpt-5.5": { in: 5, out: 20 },
  // Anthropic
  "claude-haiku-4-5-20251001": { in: 1, out: 5 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-opus-4-7": { in: 15, out: 75 },
};

const FALLBACK: ModelPrice = { in: 0.15, out: 0.6 };

function normalize(modelId: string): string {
  return modelId.replace(/-\d{4}-\d{2}-\d{2}$/, "");
}

export interface UsageTokens {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

/**
 * Estimated USD cost for a usage bucket. Reasoning tokens bill at
 * the output rate (OpenAI o-series, gpt-5.x thinking). Cached input
 * tokens bill at 10% on Anthropic; full input rate on OpenAI.
 */
export function estimateCostUsd(modelId: string, usage: UsageTokens): number {
  const price = PRICING[normalize(modelId)] ?? FALLBACK;
  const reasoning = usage.reasoningTokens ?? 0;
  const cached = usage.cachedInputTokens ?? 0;
  const fullRateInput = Math.max(0, usage.inputTokens - cached);
  const isAnthropic = modelId.startsWith("claude-");
  const cachedRate = isAnthropic ? price.in * 0.1 : price.in;
  return (
    (fullRateInput * price.in +
      cached * cachedRate +
      (usage.outputTokens + reasoning) * price.out) /
    1_000_000
  );
}

export interface ResolveModelInput {
  tier: ModelTier;
  /** Explicit provider. If omitted, falls back to MODEL_PROVIDER env. */
  provider?: Provider;
  /** Explicit API key. If omitted, falls back to OPENAI_API_KEY /
   *  ANTHROPIC_API_KEY env. */
  apiKey?: string;
}

function resolveProvider(input: ResolveModelInput): Provider {
  if (input.provider) return input.provider;
  const rawProvider = (process.env.MODEL_PROVIDER ?? "openai").toLowerCase();
  if (!isProvider(rawProvider)) {
    throw new Error(
      `MODEL_PROVIDER must be "openai" or "anthropic" (got "${rawProvider}").`,
    );
  }
  return rawProvider;
}

function resolveApiKey(input: ResolveModelInput, provider: Provider): string {
  if (input.apiKey) return input.apiKey;
  if (!providerRequiresApiKey(provider)) return "";
  const envName =
    provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
  const key = process.env[envName];
  if (!key) {
    throw new Error(
      `${envName} is not set and no apiKey override was supplied. The BYOK path in lib/byok.ts should have provided one; check that the project has a stored key for ${provider}.`,
    );
  }
  return key;
}

// Per-tier env-var override switch. Kept for dev tuning per the
// brain note on env-vars, but defaults now route through
// `resolveCanonicalModelId` so DEFAULT_MODELS in `model-config.ts`
// is the single source of truth — adding a new tier in one place
// is enough, no parallel hardcoded table here. (2026-05-17: a stale
// shadow version of this function hardcoded Haiku for every non-
// `low` tier, silently routing the new `drafter` tier to Haiku and
// burning real money before the bug was caught.)
const TIER_ENV_VAR: Record<ModelTier, string> = {
  low: "MODEL_LOW",
  baseline: "MODEL_BASELINE",
  drafter: "MODEL_DRAFTER",
};

function resolveModelId(provider: Provider, tier: ModelTier): string {
  const override = process.env[TIER_ENV_VAR[tier]];
  return resolveCanonicalModelId(provider, tier, override);
}

export interface ResolvedModel {
  /** The AI SDK LanguageModel ready to hand to streamText/generateObject. */
  model: LanguageModel;
  /** The string id used to look up pricing + tag telemetry. */
  modelId: string;
}

export function resolveModelForTier(
  input: ResolveModelInput,
): ResolvedModel {
  const provider = resolveProvider(input);
  const apiKey = resolveApiKey(input, provider);
  const modelId = resolveModelId(provider, input.tier);
  const model = getModel({ provider, apiKey, tier: input.tier, modelId });
  return { model, modelId };
}

/** Just the model id, when you need it for telemetry/persistence
 *  but don't want to instantiate the LanguageModel. */
export function modelIdForTier(input: {
  tier: ModelTier;
  provider?: Provider;
}): string {
  const provider = input.provider ?? resolveProvider({ tier: input.tier });
  return resolveModelId(provider, input.tier);
}
