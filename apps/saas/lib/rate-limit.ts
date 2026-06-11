import "server-only";
// Per-user rate limits with burst + daily windows. Implementation is
// a single Postgres function call that does count + conditional insert
// atomically (with a tiny acceptable overshoot under concurrency).
// check_rate_limit is defined in packages/db/supabase/migrations/*_init.sql.
//
// Failure mode is fail-open: if the RPC errors (DB down, function
// missing, etc.) we let the request through and log. Locking users
// out because of a DB hiccup would be worse than the cost risk.
import { createAdminClient } from "@/lib/supabase/admin";

export type RateLimitBucket =
  | "chat"
  | "extraction"
  | "conversion"
  | "byok-validate";

interface Window {
  max: number;
  windowSec: number;
}

interface BucketConfig {
  burst: Window;
  long: Window;
}

// Burst caps a single user's max activity per minute; long caps the
// daily total. Both must be under to allow the request. Tuned for the
// cost model where chat is the priciest endpoint and conversion is
// the cheapest.
export const rateLimitConfig: Record<RateLimitBucket, BucketConfig> = {
  chat: {
    burst: { max: 3, windowSec: 60 },
    long: { max: 50, windowSec: 86_400 },
  },
  extraction: {
    burst: { max: 1, windowSec: 60 },
    long: { max: 25, windowSec: 86_400 },
  },
  conversion: {
    burst: { max: 5, windowSec: 60 },
    long: { max: 150, windowSec: 86_400 },
  },
  // BYOK key validation hits OpenAI / Anthropic per attempt and the
  // Anthropic probe costs ~$0.0001 each. Without a cap an attacker can
  // use saveApiKey as an unattributed validation oracle for stolen /
  // brute-force candidate keys (and rack up our bill on the Anthropic
  // path). Tight: 3 attempts/min, 30/day. Legit users save 1–2 keys
  // total, so this is comfortably above real traffic.
  "byok-validate": {
    burst: { max: 3, windowSec: 60 },
    long: { max: 30, windowSec: 86_400 },
  },
};

export interface RateLimitVerdict {
  allowed: boolean;
  retryAfterSec: number;
  burstCount: number;
  longCount: number;
}

export async function checkRateLimit(opts: {
  userId: string;
  bucket: RateLimitBucket;
}): Promise<RateLimitVerdict> {
  const cfg = rateLimitConfig[opts.bucket];
  const admin = createAdminClient();
  // The check_rate_limit RPC isn't in the generated DB types yet —
  // the user hasn't run `db:types` against the hosted project after
  // adding this function. Cast to suppress until the regen lands.
  // biome-ignore lint/suspicious/noExplicitAny: typed RPC will be added after `db:types` regen.
  const { data, error } = await (admin as any).rpc("check_rate_limit", {
    p_user_id: opts.userId,
    p_bucket: opts.bucket,
    p_burst_window_secs: cfg.burst.windowSec,
    p_burst_max: cfg.burst.max,
    p_long_window_secs: cfg.long.windowSec,
    p_long_max: cfg.long.max,
  });
  if (error) {
    console.error("[rate-limit] check_rate_limit RPC failed", {
      bucket: opts.bucket,
      message: error.message,
    });
    return {
      allowed: true,
      retryAfterSec: 0,
      burstCount: 0,
      longCount: 0,
    };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return {
      allowed: true,
      retryAfterSec: 0,
      burstCount: 0,
      longCount: 0,
    };
  }
  return {
    allowed: Boolean(row.allowed),
    retryAfterSec: Number(row.retry_after_secs ?? 0),
    burstCount: Number(row.burst_count ?? 0),
    longCount: Number(row.long_count ?? 0),
  };
}

/** Render the standard 429 response for a denied verdict. */
export function rateLimitResponse(verdict: RateLimitVerdict): Response {
  return new Response(
    JSON.stringify({
      error: "Too many requests. Try again later.",
      retryAfterSec: verdict.retryAfterSec,
    }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(verdict.retryAfterSec),
      },
    },
  );
}
