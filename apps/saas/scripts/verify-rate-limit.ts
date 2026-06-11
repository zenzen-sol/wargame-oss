// Verifies the check_rate_limit RPC behaves correctly against the
// hosted Supabase project. Uses the service role key — same client
// the saas server actions use.
//
// Safe: writes only to rate_limit_events for a synthetic test
// user-id. Cleans up its own rows at the end.
//
// Usage (from apps/saas/):
//   bun --env-file=.env.local run scripts/verify-rate-limit.ts
//
// Run AFTER the schema is applied — check_rate_limit must exist;
// it is defined in packages/db/supabase/migrations/*_init.sql.
//
// What it checks (mirrors lib/rate-limit.ts semantics):
//   1. First call in an empty window: allowed.
//   2. Burst cap: N+1 calls within burst window — N allowed, 1 denied.
//   3. retry_after_secs is positive and < burst window.
//   4. Long cap independent of burst window (synthetic, by inserting
//      events with backdated timestamps and re-checking).

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SECRET_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in env.",
  );
  console.error("Run from apps/saas/ so .env.local is loaded automatically.");
  process.exit(1);
}

const admin = createClient<Database>(SUPABASE_URL, SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  // biome-ignore lint/suspicious/noExplicitAny: same RPC type-cast as in lib/rate-limit.ts; pending db:types regen after SQL apply.
}) as any;

// Real user id pulled from the database. rate_limit_events FKs to
// public.user, so a synthetic id fails the constraint. The test
// only touches rate_limit_events rows tagged with a unique bucket,
// so there's no interference with the user's own activity.
const TEST_BUCKET = "verify-rate-limit-script";
let TEST_USER_ID = "";

async function pickTestUserId(): Promise<string> {
  const { data, error } = await admin
    .from("user")
    .select("id")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) {
    throw new Error(
      "No rows in `user` table — sign up at least once before running this verify script.",
    );
  }
  return data.id;
}

async function cleanup(): Promise<void> {
  const { error } = await admin
    .from("rate_limit_events")
    .delete()
    .eq("user_id", TEST_USER_ID)
    .eq("bucket", TEST_BUCKET);
  if (error) throw error;
}

interface Verdict {
  allowed: boolean;
  burst_count: number;
  long_count: number;
  retry_after_secs: number;
}

async function check(
  burstMax: number,
  burstSecs: number,
  longMax: number,
  longSecs: number,
): Promise<Verdict> {
  const { data, error } = await admin.rpc("check_rate_limit", {
    p_user_id: TEST_USER_ID,
    p_bucket: TEST_BUCKET,
    p_burst_window_secs: burstSecs,
    p_burst_max: burstMax,
    p_long_window_secs: longSecs,
    p_long_max: longMax,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as Verdict;
}

function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ ${label}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  console.log("\nverifying check_rate_limit RPC\n");

  TEST_USER_ID = await pickTestUserId();
  console.log(`(using test user_id: ${TEST_USER_ID.slice(0, 8)}…)\n`);

  // Start clean. If a previous run aborted, rows might linger.
  await cleanup();

  // 1. First call in empty window → allowed.
  console.log("1. first call in empty window");
  const v1 = await check(3, 60, 50, 86_400);
  assert(v1.allowed === true, "allowed=true on first call");
  assert(v1.burst_count === 1, "burst_count==1 after first allowed insert");
  assert(v1.retry_after_secs === 0, "retry_after_secs==0 when allowed");

  // 2. Burst cap.
  console.log("\n2. burst cap (3/min)");
  // We've used 1 above; two more should still be allowed.
  const v2 = await check(3, 60, 50, 86_400);
  assert(v2.allowed === true, "2nd call allowed");
  const v3 = await check(3, 60, 50, 86_400);
  assert(v3.allowed === true, "3rd call allowed");
  // 4th hits the burst cap.
  const v4 = await check(3, 60, 50, 86_400);
  assert(v4.allowed === false, "4th call denied");
  assert(
    v4.retry_after_secs > 0 && v4.retry_after_secs <= 60,
    `retry_after_secs in (0, 60] on burst-deny (got ${v4.retry_after_secs})`,
  );

  // 3. Long cap with backdated rows.
  // Reset and synthesize 50 events spanning the last hour, then check
  // a non-burst-busting call to confirm the daily cap fires.
  console.log("\n3. long cap (synthetic backfill)");
  await cleanup();
  const inserts = Array.from({ length: 50 }, (_, i) => ({
    user_id: TEST_USER_ID,
    bucket: TEST_BUCKET,
    // Spread across the last hour so the burst window is empty.
    occurred_at: new Date(Date.now() - (i + 1) * 70_000).toISOString(),
  }));
  const { error: insertErr } = await admin
    .from("rate_limit_events")
    .insert(inserts);
  if (insertErr) throw insertErr;
  // Burst window is empty (everything is 70s+ old), long window has 50
  // events; long_max is 50, so this should deny.
  const v5 = await check(3, 60, 50, 86_400);
  assert(v5.allowed === false, "denied on long cap");
  assert(
    v5.burst_count === 0,
    `burst_count==0 (events are outside 60s window, got ${v5.burst_count})`,
  );
  assert(v5.long_count === 50, `long_count==50 (got ${v5.long_count})`);

  await cleanup();
  console.log("\nall checks passed.\n");
}

main().catch(async (err) => {
  console.error("FAILED:", err);
  // Best-effort cleanup so retries start clean.
  try {
    await cleanup();
  } catch (cleanupErr) {
    console.error("(cleanup also failed:", cleanupErr, ")");
  }
  process.exit(1);
});
