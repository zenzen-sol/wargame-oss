#!/usr/bin/env bun
// First-run setup: creates the three .env.local files, generates the
// app secrets so the must-match pairs match by construction, prompts
// for the Supabase + LLM credentials that can't be generated, and
// finishes with a doctor pass that verifies the invariants the apps
// fail silently without.
//
//   bun run setup          # full flow (idempotent; only fills blanks)
//   bun run setup --check  # doctor only, no writes
//
// Re-running never overwrites a non-empty value.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

const ROOT = join(import.meta.dir, "..");
const SAAS = join(ROOT, "apps/saas/.env.local");
const WORKFLOWS = join(ROOT, "apps/workflows/.env.local");
const DB = join(ROOT, "packages/db/.env.local");

const FILES: Array<{ envLocal: string; example: string }> = [
  { envLocal: SAAS, example: join(ROOT, "apps/saas/.env.example") },
  { envLocal: WORKFLOWS, example: join(ROOT, "apps/workflows/.env.example") },
  { envLocal: DB, example: join(ROOT, "packages/db/.env.example") },
];

// ---------------------------------------------------------------------------
// env-file helpers (line-preserving; comments stay intact)
// ---------------------------------------------------------------------------

function readEnv(file: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(file)) return map;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m?.[1] !== undefined) map.set(m[1], m[2] ?? "");
  }
  return map;
}

function upsertEnv(file: string, key: string, value: string): void {
  const lines = readFileSync(file, "utf8").split("\n");
  const assignment = `${key}=${value}`;
  const liveIdx = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (liveIdx !== -1) {
    lines[liveIdx] = assignment;
  } else {
    const commentedIdx = lines.findIndex((l) =>
      l.match(new RegExp(`^#\\s*${key}=`)),
    );
    if (commentedIdx !== -1) lines.splice(commentedIdx + 1, 0, assignment);
    else lines.push(assignment);
  }
  writeFileSync(file, lines.join("\n"));
}

function setIfBlank(file: string, key: string, value: string): boolean {
  const current = readEnv(file).get(key);
  if (current) return false;
  upsertEnv(file, key, value);
  return true;
}

// ---------------------------------------------------------------------------
// prompting
// ---------------------------------------------------------------------------

// readline.question drops lines that arrive while no question is
// pending, which breaks piped/scripted input (everything arrives at
// once). Queue lines ourselves instead; works for TTY and pipes.
const rl = createInterface({ input: process.stdin });
let stdinClosed = false;
const pendingLines: string[] = [];
const lineWaiters: Array<(line: string) => void> = [];
rl.on("line", (line) => {
  const waiter = lineWaiters.shift();
  if (waiter) waiter(line);
  else pendingLines.push(line);
});
rl.on("close", () => {
  stdinClosed = true;
  while (lineWaiters.length) lineWaiters.shift()?.("");
});

function nextLine(): Promise<string> {
  const buffered = pendingLines.shift();
  if (buffered !== undefined) return Promise.resolve(buffered);
  if (stdinClosed) return Promise.resolve("");
  return new Promise((resolve) => lineWaiters.push(resolve));
}

async function ask(label: string, hint: string): Promise<string> {
  if (stdinClosed && pendingLines.length === 0) return "";
  console.log(`\n${label}`);
  console.log(`  ${hint}`);
  process.stdout.write("> ");
  return (await nextLine()).trim();
}

async function promptIfBlank(
  files: string[],
  key: string,
  label: string,
  hint: string,
  opts: { optional?: boolean } = {},
): Promise<void> {
  const primary = files[0];
  if (!primary) return;
  if (readEnv(primary).get(key)) {
    for (const f of files.slice(1)) {
      const v = readEnv(primary).get(key);
      if (v) setIfBlank(f, key, v);
    }
    return;
  }
  let value = "";
  while (!value) {
    value = await ask(label, hint);
    if (!value && opts.optional) return;
    if (!value && stdinClosed) {
      // Piped/non-interactive run ran out of answers. Leave the key
      // blank rather than spinning; the doctor will flag it.
      console.log(`  (no input; leaving ${key} blank)`);
      return;
    }
    if (!value) console.log("  Required; paste a value.");
  }
  for (const f of files) upsertEnv(f, key, value);
}

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------

let failures = 0;
let warnings = 0;

function pass(msg: string): void {
  console.log(`  ok    ${msg}`);
}
function fail(msg: string): void {
  failures++;
  console.log(`  FAIL  ${msg}`);
}
function warn(msg: string): void {
  warnings++;
  console.log(`  warn  ${msg}`);
}

async function doctor(): Promise<void> {
  console.log("\nDoctor:");
  for (const envLocal of [SAAS, WORKFLOWS]) {
    if (!existsSync(envLocal)) {
      fail(`${envLocal} missing — run \`bun run setup\``);
      return;
    }
  }
  // The db env only feeds AUTH_RESEND_KEY into Supabase's config.toml;
  // dev with DEV_AUTH_BYPASS never sends email.
  if (!existsSync(DB)) warn(`${DB} missing (only needed for Resend SMTP config)`);
  const saas = readEnv(SAAS);
  const wf = readEnv(WORKFLOWS);

  // Must-match pairs. These fail silently at runtime when they drift.
  for (const key of ["WORKFLOW_AUTH_TOKEN", "API_KEY_ENCRYPTION_SECRET"]) {
    const a = saas.get(key);
    const b = wf.get(key);
    if (!a || !b) fail(`${key} is empty in ${!a ? "saas" : "workflows"}`);
    else if (a !== b) fail(`${key} differs between saas and workflows`);
    else pass(`${key} matches across apps`);
  }
  const enc = saas.get("API_KEY_ENCRYPTION_SECRET") ?? "";
  if (enc && !/^[0-9a-f]{64}$/i.test(enc))
    warn("API_KEY_ENCRYPTION_SECRET is not 64 hex chars (openssl rand -hex 32)");

  if (saas.get("BETTER_AUTH_SECRET")) pass("BETTER_AUTH_SECRET set");
  else fail("BETTER_AUTH_SECRET is empty");

  // Supabase coherence.
  const url = saas.get("NEXT_PUBLIC_SUPABASE_URL") ?? "";
  if (!url) fail("NEXT_PUBLIC_SUPABASE_URL is empty in saas");
  else if (url !== wf.get("NEXT_PUBLIC_SUPABASE_URL"))
    fail("NEXT_PUBLIC_SUPABASE_URL differs between saas and workflows");
  else pass("NEXT_PUBLIC_SUPABASE_URL matches across apps");
  for (const key of [
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_JWT_SECRET",
    "BETTER_AUTH_DATABASE_URL",
  ]) {
    if (saas.get(key)) pass(`${key} set`);
    else fail(`${key} is empty in saas`);
  }
  if (wf.get("SUPABASE_SECRET_KEY")) pass("SUPABASE_SECRET_KEY set in workflows");
  else fail("SUPABASE_SECRET_KEY is empty in workflows");

  // Live ping. GoTrue's health endpoint accepts the publishable key;
  // PostgREST's root 401s under the new sb_publishable_ keys, so it
  // can't serve as the probe.
  const apikey = saas.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ?? "";
  if (url && apikey) {
    try {
      const res = await fetch(`${url}/auth/v1/health`, {
        headers: { apikey },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) pass(`Supabase reachable (${url})`);
      else fail(`Supabase responded ${res.status} — check URL and publishable key`);
    } catch (err) {
      fail(`Supabase unreachable: ${err instanceof Error ? err.message : err}`);
    }
  }

  // LLM dev fallback.
  const provider = saas.get("MODEL_PROVIDER") ?? "";
  const keyName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  if (!provider) warn("MODEL_PROVIDER unset; dev fallback LLM calls will fail");
  else if (!saas.get(keyName))
    warn(`${keyName} unset in saas; dev fallback LLM calls will fail`);
  else if (!wf.get(keyName))
    warn(`${keyName} unset in workflows; extraction will fail in dev`);
  else pass(`dev LLM fallback configured (${provider})`);

  if (saas.get("DEV_AUTH_BYPASS") === "1")
    pass("DEV_AUTH_BYPASS=1 — sign in locally via /api/dev/sign-in");
  else
    warn("DEV_AUTH_BYPASS is off — local sign-in requires a Resend key");
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const checkOnly = process.argv.includes("--check");

if (!checkOnly) {
  console.log("Wargame setup\n");

  for (const { envLocal, example } of FILES) {
    if (!existsSync(envLocal)) {
      copyFileSync(example, envLocal);
      console.log(`created ${envLocal}`);
    }
  }

  // Secrets: generated, and written to every file that needs them in
  // the same breath, so the must-match invariant can't be violated.
  const generated: string[] = [];
  if (setIfBlank(SAAS, "BETTER_AUTH_SECRET", randomBytes(32).toString("hex")))
    generated.push("BETTER_AUTH_SECRET");
  const encExisting =
    readEnv(SAAS).get("API_KEY_ENCRYPTION_SECRET") ||
    readEnv(WORKFLOWS).get("API_KEY_ENCRYPTION_SECRET") ||
    randomBytes(32).toString("hex");
  if (setIfBlank(SAAS, "API_KEY_ENCRYPTION_SECRET", encExisting))
    generated.push("API_KEY_ENCRYPTION_SECRET");
  setIfBlank(WORKFLOWS, "API_KEY_ENCRYPTION_SECRET", encExisting);
  const tokenExisting =
    readEnv(SAAS).get("WORKFLOW_AUTH_TOKEN") ||
    readEnv(WORKFLOWS).get("WORKFLOW_AUTH_TOKEN") ||
    randomBytes(16).toString("hex");
  setIfBlank(SAAS, "WORKFLOW_AUTH_TOKEN", tokenExisting);
  setIfBlank(WORKFLOWS, "WORKFLOW_AUTH_TOKEN", tokenExisting);
  if (generated.length) console.log(`generated: ${generated.join(", ")}`);

  console.log(
    "\nSupabase credentials (dashboard: https://supabase.com/dashboard," +
      "\nyour project, Settings):",
  );
  await promptIfBlank(
    [SAAS, WORKFLOWS],
    "NEXT_PUBLIC_SUPABASE_URL",
    "Project URL",
    "Settings → API → Project URL (https://<ref>.supabase.co)",
  );
  await promptIfBlank(
    [SAAS],
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "Publishable key",
    "Settings → API → Publishable key (sb_publishable_…)",
  );
  await promptIfBlank(
    [SAAS, WORKFLOWS],
    "SUPABASE_SECRET_KEY",
    "Secret key",
    "Settings → API → Secret keys (sb_secret_…)",
  );
  await promptIfBlank(
    [SAAS],
    "SUPABASE_JWT_SECRET",
    "Legacy JWT secret",
    "Settings → JWT Keys → Legacy JWT Secret → Reveal",
  );
  await promptIfBlank(
    [SAAS],
    "BETTER_AUTH_DATABASE_URL",
    "Postgres connection string",
    "Settings → Database → Connection string → URI (paste with password)",
  );

  console.log("\nLLM key for local development (production users bring their own):");
  let provider = readEnv(SAAS).get("MODEL_PROVIDER") ?? "";
  if (!provider) {
    provider =
      (await ask("Provider", 'Type "openai" or "anthropic" (default openai)')) ||
      "openai";
    if (provider !== "anthropic") provider = "openai";
    for (const f of [SAAS, WORKFLOWS]) upsertEnv(f, "MODEL_PROVIDER", provider);
  }
  const llmKeyName =
    provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  await promptIfBlank(
    [SAAS, WORKFLOWS],
    llmKeyName,
    `${llmKeyName}`,
    "Used only as the local-dev fallback; leave blank to skip",
    { optional: true },
  );
}

await doctor();
rl.close();

if (failures === 0) {
  console.log("\nNext steps:");
  console.log("  1. bun db:link            # link to your Supabase project");
  console.log(
    "  2. Run packages/db/supabase/migrations/*_init.sql in the Supabase SQL editor",
  );
  console.log("  3. bun dev                # then open http://localhost:3000");
  console.log(
    "     Sign in locally via http://localhost:3000/api/dev/sign-in",
  );
  if (warnings) console.log(`\n${warnings} warning(s) above.`);
} else {
  console.log(`\n${failures} check(s) failed. Fix the FAIL lines and re-run.`);
  process.exit(1);
}
