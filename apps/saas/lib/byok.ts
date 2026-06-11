import "server-only";
// BYOK orchestration: look up a user's stored API key for a given
// provider and return the decrypted plaintext for an LLM call.
//
// Uses the admin Supabase client (bypasses RLS) because the
// originating context — the chat route — has already established
// ownership via requireProjectById. The key never leaves server
// memory; we hand the plaintext to the AI SDK and discard.
//
// Dev override: when DEV_AUTH_BYPASS=1 (local dev only — hard-fails
// in production at module load in lib/auth.ts) and the user has no
// stored key, falls back to process.env.{OPENAI,ANTHROPIC}_API_KEY.
// That lets agent-driven testing run end-to-end without pasting
// personal credentials. The fallback can't fire in prod because the
// guard checks NODE_ENV.
//
// Failure modes are explicit error types so the chat route can
// surface a clean message ("Configure your <Provider> key in
// Settings") rather than a generic 500.
import { decryptApiKey } from "@wargame-esq/agents";
import { createAdminClient } from "@/lib/supabase/admin";

export type Provider = "openai" | "anthropic";

export type GetApiKeyError =
  | { kind: "no-key"; provider: Provider }
  | { kind: "no-provider" }
  | { kind: "decrypt-failed"; message: string }
  | { kind: "db-error"; message: string };

export type GetApiKeyResult =
  | { ok: true; apiKey: string; lastValidatedAt: string | null; source: "user" | "dev-fallback" }
  | { ok: false; error: GetApiKeyError };

function devFallbackKey(provider: Provider): string | null {
  if (process.env.DEV_AUTH_BYPASS !== "1") return null;
  if (process.env.NODE_ENV === "production") return null;
  const envKey =
    provider === "openai"
      ? process.env.OPENAI_API_KEY
      : process.env.ANTHROPIC_API_KEY;
  return envKey && envKey.length > 0 ? envKey : null;
}

/** Looks up the user's stored key for `provider` and decrypts. */
export async function getApiKeyForUser(opts: {
  userId: string;
  provider: Provider;
}): Promise<GetApiKeyResult> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("user_api_keys")
    .select("encrypted_key, iv, auth_tag, last_validated_at")
    .eq("user_id", opts.userId)
    .eq("provider", opts.provider)
    .maybeSingle();
  if (error) {
    return { ok: false, error: { kind: "db-error", message: error.message } };
  }
  if (!data) {
    const fallback = devFallbackKey(opts.provider);
    if (fallback) {
      return { ok: true, apiKey: fallback, lastValidatedAt: null, source: "dev-fallback" };
    }
    return { ok: false, error: { kind: "no-key", provider: opts.provider } };
  }
  try {
    const apiKey = decryptApiKey({
      encryptedKey: data.encrypted_key,
      iv: data.iv,
      authTag: data.auth_tag,
    });
    return {
      ok: true,
      apiKey,
      lastValidatedAt: data.last_validated_at,
      source: "user",
    };
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

/** Convenience: project-driven lookup. Reads the project's snapshot
 *  `provider` and the owner's stored key for that provider. */
export async function getApiKeyForProject(opts: {
  ownerId: string;
  provider: Provider | null;
}): Promise<GetApiKeyResult> {
  if (!opts.provider) {
    return { ok: false, error: { kind: "no-provider" } };
  }
  return getApiKeyForUser({
    userId: opts.ownerId,
    provider: opts.provider,
  });
}

/** Returns the list of providers this user has working keys for,
 *  with which one is the default for new projects. Pure user data —
 *  does NOT include the dev fallback, because UI flows that ask
 *  "what does the user have configured?" shouldn't be misled by an
 *  env shortcut. */
export async function listConfiguredProviders(opts: {
  userId: string;
}): Promise<ConfiguredProvider[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("user_api_keys")
    .select("provider, is_default")
    .eq("user_id", opts.userId);
  if (error) return [];
  return (data ?? []).map((r) => ({
    provider: r.provider as Provider,
    isDefault: Boolean(r.is_default),
  }));
}

export type ConfiguredProvider = {
  provider: Provider;
  isDefault: boolean;
};

/** Returns the user's default provider for new projects, or null
 *  if no keys are configured. The default is whichever row has
 *  `is_default = true`; the partial unique index guarantees at
 *  most one. */
export async function getDefaultProvider(opts: {
  userId: string;
}): Promise<Provider | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("user_api_keys")
    .select("provider")
    .eq("user_id", opts.userId)
    .eq("is_default", true)
    .maybeSingle();
  if (error || !data) return null;
  return data.provider as Provider;
}
