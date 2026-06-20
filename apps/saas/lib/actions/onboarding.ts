"use server";
// Onboarding actions. Two pieces:
//   - acceptDisclaimer: stamps `user.disclaimer_acknowledged_at = now()`
//   - saveApiKey: validates → encrypts → upserts into user_api_keys
//
// Both run under requireUser so a logged-out caller is redirected to
// /sign-in by the auth helper before reaching the action body. After
// success, the calling page uses redirect() to advance the user to
// the next onboarding step.
import { requireUser, requireUserWithDisclaimer } from "@/lib/auth-session";
import { acknowledgeDisclaimer } from "@/lib/better-auth-db";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptApiKey, validateApiKey } from "@wargame-esq/agents";
import { revalidatePath } from "next/cache";

export type Provider = "openai" | "anthropic";

export interface SaveApiKeyResult {
  ok: boolean;
  /** Surfaced to the UI on failure. Never echoes the key. */
  message?: string;
}

export async function acceptDisclaimer(): Promise<void> {
  const user = await requireUser();
  await acknowledgeDisclaimer(user.id);
  // The (auth) layout's gate will re-evaluate on next navigation; the
  // welcome page redirects to the next step on success.
  revalidatePath("/", "layout");
}

export async function saveApiKey(input: {
  provider: Provider;
  apiKey: string;
}): Promise<SaveApiKeyResult> {
  // saveApiKey lives in the post-disclaimer onboarding step — the
  // (welcome) layout enforces this for the navigation path. Add the
  // direct-invocation guard so a caller who skipped the disclaimer
  // can't reach this either.
  const user = await requireUserWithDisclaimer();

  const trimmed = input.apiKey.trim();
  if (!trimmed) {
    return { ok: false, message: "API key is empty." };
  }

  // Rate-limit the validate path. validateApiKey makes an outbound
  // call to OpenAI / Anthropic per attempt (Anthropic's probe costs
  // ~$0.0001), so without a cap this becomes an unattributed key-
  // validation oracle and a way to burn money on Anthropic. The
  // limit is generous enough for real users (who save 1–2 keys
  // total) but blocks the spammy patterns.
  const verdict_rl = await checkRateLimit({
    userId: user.id,
    bucket: "byok-validate",
  });
  if (!verdict_rl.allowed) {
    return {
      ok: false,
      message: `Too many key-validation attempts. Try again in ${verdict_rl.retryAfterSec}s.`,
    };
  }

  // Probe before persisting so the user gets immediate feedback. A
  // saved-but-broken key would only fail at the next wargame run,
  // which is way too late.
  const verdict = await validateApiKey(input.provider, trimmed);
  if (!verdict.ok) {
    return { ok: false, message: verdict.message ?? "Could not validate key." };
  }

  // Encrypt only after we know the key works. The IV is randomized
  // per encryption so the same plaintext stored by two users yields
  // different ciphertexts.
  const { encryptedKey, iv, authTag } = encryptApiKey(trimmed);

  const admin = createAdminClient();

  // Default-provider invariant: if this is the user's first key (or
  // they have no default flagged for any reason), promote this one
  // to default. Subsequent saves don't change the default — the
  // user explicitly picks via setDefaultProvider.
  const { data: existingDefault } = await admin
    .from("user_api_keys")
    .select("provider")
    .eq("user_id", user.id)
    .eq("is_default", true)
    .maybeSingle();
  const shouldBeDefault = !existingDefault;

  const { error } = await admin.from("user_api_keys").upsert(
    {
      user_id: user.id,
      provider: input.provider,
      encrypted_key: encryptedKey,
      iv,
      auth_tag: authTag,
      last_validated_at: new Date().toISOString(),
      is_default: shouldBeDefault,
    },
    { onConflict: "user_id,provider" },
  );
  if (error) {
    console.error("[onboarding] saveApiKey upsert failed", error);
    return { ok: false, message: "Could not save key. Try again." };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Pick which provider is the user's default for new projects.
 *  Atomic-enough flip: clears any existing default, sets the
 *  requested one. Returns ok:false if the user has no key for the
 *  requested provider — the UI shouldn't offer providers the user
 *  hasn't configured. */
export async function setDefaultProvider(input: {
  provider: Provider;
}): Promise<SaveApiKeyResult> {
  const user = await requireUser();
  const admin = createAdminClient();

  const { data: existing, error: readErr } = await admin
    .from("user_api_keys")
    .select("provider")
    .eq("user_id", user.id);
  if (readErr) {
    console.error("[onboarding] setDefaultProvider read failed", readErr);
    return { ok: false, message: "Could not update default." };
  }
  const has = existing?.some((r) => r.provider === input.provider);
  if (!has) {
    return {
      ok: false,
      message: "Add a key for that provider before making it the default.",
    };
  }

  // Clear-then-set: the partial unique index `(user_id) where is_default`
  // never sees two true rows at once. Both writes are scoped to this
  // user, so we don't need an explicit transaction — worst case a
  // concurrent caller racing the same flip leaves is_default cleared
  // briefly, recoverable by retry.
  const { error: clearErr } = await admin
    .from("user_api_keys")
    .update({ is_default: false })
    .eq("user_id", user.id)
    .eq("is_default", true);
  if (clearErr) {
    console.error("[onboarding] setDefaultProvider clear failed", clearErr);
    return { ok: false, message: "Could not update default." };
  }
  const { error: setErr } = await admin
    .from("user_api_keys")
    .update({ is_default: true })
    .eq("user_id", user.id)
    .eq("provider", input.provider);
  if (setErr) {
    console.error("[onboarding] setDefaultProvider set failed", setErr);
    return { ok: false, message: "Could not update default." };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteApiKey(input: {
  provider: Provider;
}): Promise<void> {
  const user = await requireUser();
  const admin = createAdminClient();

  // Capture default-ness before deletion so we know whether to
  // reassign. A missing row (e.g. UI double-fire) is a no-op.
  const { data: row } = await admin
    .from("user_api_keys")
    .select("is_default")
    .eq("user_id", user.id)
    .eq("provider", input.provider)
    .maybeSingle();

  const { error } = await admin
    .from("user_api_keys")
    .delete()
    .eq("user_id", user.id)
    .eq("provider", input.provider);
  if (error) throw error;

  // If we just removed the default, hand the flag to a surviving
  // key (deterministic pick: alphabetical) so createProject keeps
  // working without a settings detour. If no keys remain, leave it
  // unset — the user must add one before creating projects.
  if (row?.is_default) {
    const { data: survivors } = await admin
      .from("user_api_keys")
      .select("provider")
      .eq("user_id", user.id)
      .order("provider", { ascending: true })
      .limit(1);
    const next = survivors?.[0]?.provider;
    if (next) {
      await admin
        .from("user_api_keys")
        .update({ is_default: true })
        .eq("user_id", user.id)
        .eq("provider", next);
    }
  }

  revalidatePath("/", "layout");
}
