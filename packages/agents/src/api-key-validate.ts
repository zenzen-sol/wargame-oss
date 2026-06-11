// Provider key validation. One cheap probe call per provider that
// returns success/failure quickly. Called once on save in the
// onboarding / settings flow; the result drives the UI's "Validated"
// state and `last_validated_at`.
//
// Cost: OpenAI /v1/models is free. Anthropic's smallest /v1/messages
// call is roughly $0.0001. We accept that micropayment as the price
// of "your key is verified" UX.

import type { Provider } from "./model-config";

export interface ValidateResult {
  ok: boolean;
  /** Human-readable error message when ok=false. Never includes the
   *  key value. */
  message?: string;
}

export async function validateApiKey(
  provider: Provider,
  apiKey: string,
): Promise<ValidateResult> {
  if (!apiKey || apiKey.trim().length === 0) {
    return { ok: false, message: "Key is empty." };
  }
  if (provider === "openai") {
    return validateOpenAI(apiKey);
  }
  if (provider === "anthropic") {
    return validateAnthropic(apiKey);
  }
  return { ok: false, message: `Unknown provider: ${provider}` };
}

async function validateOpenAI(apiKey: string): Promise<ValidateResult> {
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { ok: true };
    if (res.status === 401) {
      return { ok: false, message: "Invalid OpenAI API key." };
    }
    if (res.status === 429) {
      return { ok: false, message: "OpenAI rate-limited the verification. Try again in a moment." };
    }
    // Don't echo upstream body bytes back to the caller — that turns
    // saveApiKey into an oracle that leaks provider responses for
    // arbitrary candidate keys. Generic message + server-side log
    // for operator visibility.
    console.warn(
      `[validate openai] unexpected status=${res.status} (body suppressed)`,
    );
    return { ok: false, message: "Could not validate OpenAI key." };
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return { ok: false, message: "OpenAI verification timed out (10s)." };
    }
    console.warn("[validate openai] fetch failed", err);
    return { ok: false, message: "Could not reach OpenAI to validate." };
  }
}

async function validateAnthropic(apiKey: string): Promise<ValidateResult> {
  // Smallest valid Anthropic call: one input token, max_tokens=1. The
  // model name must be a real one; using haiku since it's cheapest.
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "." }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { ok: true };
    if (res.status === 401) {
      return { ok: false, message: "Invalid Anthropic API key." };
    }
    if (res.status === 429) {
      return {
        ok: false,
        message: "Anthropic rate-limited the verification. Try again in a moment.",
      };
    }
    // See validateOpenAI: don't echo body bytes.
    console.warn(
      `[validate anthropic] unexpected status=${res.status} (body suppressed)`,
    );
    return { ok: false, message: "Could not validate Anthropic key." };
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return { ok: false, message: "Anthropic verification timed out (10s)." };
    }
    console.warn("[validate anthropic] fetch failed", err);
    return { ok: false, message: "Could not reach Anthropic to validate." };
  }
}
