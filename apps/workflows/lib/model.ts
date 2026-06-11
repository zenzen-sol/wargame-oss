// Thin re-exports from @wargame-esq/agents/runtime. The factory +
// pricing live in the package so saas Edge routes and the workflow
// share one source of truth.
//
// Post-BYOK: callers pass `creds` explicitly (sourced via
// lib/byok.ts → getLLMCredsForProject). Calls without `creds` fall
// back to env via the agents runtime's env-resolution path; that
// branch is reserved for dev/local scripts.

import { resolveModelForTier } from "@wargame-esq/agents";
import type { LanguageModel } from "ai";

interface LLMCreds {
  provider: "openai" | "anthropic";
  apiKey: string;
}

export function getLowModel(creds?: LLMCreds): LanguageModel {
  return resolveModelForTier({
    tier: "low",
    provider: creds?.provider,
    apiKey: creds?.apiKey,
  }).model;
}

export function getBaselineModel(creds?: LLMCreds): LanguageModel {
  return resolveModelForTier({
    tier: "baseline",
    provider: creds?.provider,
    apiKey: creds?.apiKey,
  }).model;
}
