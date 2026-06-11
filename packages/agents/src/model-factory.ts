// AI SDK model factory. Pattern lifted from augustus-omni's
// `getModel` (lib/chat/document-context.ts): use the SDK's
// `create*({ apiKey })` provider constructors instead of the
// env-driven defaults so the call site stays explicit about which
// key it's using. That decoupling is what lets a future settings UI
// pass a per-user key into the same factory without touching env.

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import {
  type ModelTier,
  type Provider,
  resolveModelId,
} from "./model-config";

export interface GetModelInput {
  provider: Provider;
  /** Provider-specific API key. Required — pass it explicitly. */
  apiKey: string;
  /** Tier picks the default if `modelId` isn't provided or doesn't match the catalog. */
  tier: ModelTier;
  /** Optional explicit model id; falls back to the tier default. Validated against MODEL_OPTIONS. */
  modelId?: string;
}

/**
 * Build an AI SDK `LanguageModel` for the given provider/tier. Pure
 * — no env reads, no global state. Consumers wire env (or a settings
 * row) into this in their own boundary code.
 */
export function getModel({
  provider,
  apiKey,
  tier,
  modelId,
}: GetModelInput): LanguageModel {
  const resolved = resolveModelId(provider, tier, modelId);
  switch (provider) {
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey });
      return anthropic(resolved);
    }
    case "openai": {
      const openai = createOpenAI({ apiKey });
      return openai(resolved);
    }
  }
}
