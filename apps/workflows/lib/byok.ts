// BYOK lookup for the workflows runtime. Mirrors apps/saas/lib/byok.ts
// but uses the workflows admin client and has no Next-specific
// "server-only" import (the workflows app is server-only by design).
//
// Workflow steps call this with a projectId; we read project.provider
// + project.owner_id, then fetch + decrypt the owner's stored key for
// that provider. The plaintext is short-lived (handed to the LLM call,
// then discarded).
//
// Dev fallback: if DEV_AUTH_BYPASS=1 AND NODE_ENV !== production AND
// no stored key is found, falls back to env keys so locally-driven
// agent testing works without pasting personal credentials.

import { createAdminClient } from "@/lib/supabase/admin";
import { decryptApiKey } from "@wargame-esq/agents";

export type Provider = "openai" | "anthropic";

export type GetLLMCredsError =
  | { kind: "no-provider"; projectId: string }
  | { kind: "no-key"; provider: Provider }
  | { kind: "decrypt-failed"; message: string }
  | { kind: "db-error"; message: string }
  | { kind: "not-found"; projectId: string };

export type GetLLMCredsResult =
  | { ok: true; provider: Provider; apiKey: string; source: "user" | "dev-fallback" }
  | { ok: false; error: GetLLMCredsError };

function devFallbackKey(provider: Provider): string | null {
  if (process.env.DEV_AUTH_BYPASS !== "1") return null;
  if (process.env.NODE_ENV === "production") return null;
  const envKey =
    provider === "openai"
      ? process.env.OPENAI_API_KEY
      : process.env.ANTHROPIC_API_KEY;
  return envKey && envKey.length > 0 ? envKey : null;
}

/** Resolves the LLM credentials for a project: snapshot provider +
 *  owner's stored key, decrypted. Used inside extraction workflow
 *  steps before any LLM call. */
export async function getLLMCredsForProject(
  projectId: string,
): Promise<GetLLMCredsResult> {
  const admin = createAdminClient();

  const { data: project, error: projectErr } = await admin
    .from("projects")
    .select("provider, owner_id")
    .eq("id", projectId)
    .maybeSingle();
  if (projectErr) {
    return {
      ok: false,
      error: { kind: "db-error", message: projectErr.message },
    };
  }
  if (!project) {
    return { ok: false, error: { kind: "not-found", projectId } };
  }
  if (!project.provider) {
    return { ok: false, error: { kind: "no-provider", projectId } };
  }
  const provider = project.provider as Provider;

  const { data: keyRow, error: keyErr } = await admin
    .from("user_api_keys")
    .select("encrypted_key, iv, auth_tag")
    .eq("user_id", project.owner_id)
    .eq("provider", provider)
    .maybeSingle();
  if (keyErr) {
    return {
      ok: false,
      error: { kind: "db-error", message: keyErr.message },
    };
  }
  if (!keyRow) {
    const fallback = devFallbackKey(provider);
    if (fallback) {
      return { ok: true, provider, apiKey: fallback, source: "dev-fallback" };
    }
    return { ok: false, error: { kind: "no-key", provider } };
  }
  try {
    const apiKey = decryptApiKey({
      encryptedKey: keyRow.encrypted_key,
      iv: keyRow.iv,
      authTag: keyRow.auth_tag,
    });
    return { ok: true, provider, apiKey, source: "user" };
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "decrypt-failed",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
