// Verifies the atomic run-claim semantics in route.ts against the
// hosted Supabase project. Uses the service role key from
// apps/saas/.env.local — same client the chat route uses.
//
// Safe: only writes the projects.run_started_at column on the one
// project ID you pass. Does not touch issues, messages, or status.
//
// Usage:
//   cd apps/saas && bun run scripts/verify-run-claim.ts <projectId>
//
// What it checks (mirrors route.ts handlePost claim logic):
//   1. Concurrent claim race — 8 parallel UPDATEs, exactly one wins.
//   2. Stale-claim takeover — a 6.5-minute-old claim is stealable.
//   3. Fresh-claim block — a 1-minute-old claim is NOT stealable.
//   4. Idempotent release — calling release twice is harmless.

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const projectIdArg = process.argv[2];

if (!SUPABASE_URL || !SECRET_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in env.",
  );
  console.error(
    "Run from apps/saas/ so .env.local is loaded automatically.",
  );
  process.exit(1);
}
if (!projectIdArg) {
  console.error("Usage: bun run scripts/verify-run-claim.ts <projectId>");
  process.exit(1);
}
const projectId: string = projectIdArg;

const admin = createClient<Database>(SUPABASE_URL, SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const STALE_CLAIM_MS = 6 * 60 * 1000;

async function release(): Promise<void> {
  const r = await admin
    .from("projects")
    .update({ run_started_at: null })
    .eq("id", projectId);
  if (r.error) throw r.error;
}

async function claim(): Promise<{ won: boolean; at: string }> {
  const at = new Date();
  const staleBefore = new Date(at.getTime() - STALE_CLAIM_MS);
  const res = await admin
    .from("projects")
    .update({ run_started_at: at.toISOString() })
    .eq("id", projectId)
    .or(
      `run_started_at.is.null,run_started_at.lt.${staleBefore.toISOString()}`,
    )
    .select("id");
  if (res.error) throw res.error;
  return { won: (res.data?.length ?? 0) > 0, at: at.toISOString() };
}

async function setClaimAge(ageMs: number): Promise<void> {
  const ts = new Date(Date.now() - ageMs).toISOString();
  const r = await admin
    .from("projects")
    .update({ run_started_at: ts })
    .eq("id", projectId);
  if (r.error) throw r.error;
}

function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ ${label}`);
    process.exit(1);
  }
}

async function main() {
  console.log(`\nverifying run-claim semantics on project ${projectId}\n`);

  // Confirm project exists before we start mutating its column.
  const exists = await admin
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();
  if (exists.error) throw exists.error;
  if (!exists.data) {
    console.error(`project ${projectId} not found.`);
    process.exit(1);
  }
  console.log(`(target: ${exists.data.name})\n`);

  // 1. Concurrent race.
  console.log("1. concurrent claim race (8 parallel)");
  await release();
  const results = await Promise.all(
    Array.from({ length: 8 }, () => claim()),
  );
  const winners = results.filter((r) => r.won);
  assert(
    winners.length === 1,
    `exactly one winner (got ${winners.length})`,
  );

  // 2. Stale-claim takeover.
  console.log("2. stale-claim takeover");
  await setClaimAge(STALE_CLAIM_MS + 30_000); // 6.5 min old
  const stealResult = await claim();
  assert(stealResult.won, "fresh POST steals a stale claim");

  // 3. Fresh-claim blocks.
  console.log("3. fresh-claim blocks");
  await setClaimAge(60_000); // 1 min old
  const blockedResult = await claim();
  assert(!blockedResult.won, "1-minute-old claim is NOT stealable");

  // 4. Idempotent release.
  console.log("4. idempotent release");
  await release();
  await release();
  const afterDoubleRelease = await claim();
  assert(afterDoubleRelease.won, "claim succeeds after double-release");

  // Clean up so the project isn't left with a stray claim.
  await release();
  console.log("\nall checks passed.\n");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
