#!/usr/bin/env bun
// First-run setup: creates the three .env.local files, generates the
// app secrets so the must-match pairs match by construction, points
// the apps at a Supabase instance, and finishes with a doctor pass
// that verifies the invariants the apps fail silently without.
//
//   bun run setup           # local Supabase via Docker (the default):
//                           #   starts the stack, applies migrations,
//                           #   writes every env value automatically
//   bun run setup --hosted  # hosted Supabase: prompts for credentials
//   bun run setup --check   # doctor only, no writes
//   bun run setup --launch  # setup, start dev, open the dev sign-in page
//
// Re-running never overwrites a non-empty value, with one exception:
// local mode refreshes Supabase values that already point at
// localhost (the stack's keys can change after `supabase stop`).

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

const ROOT = join(import.meta.dir, "..");
const SAAS = join(ROOT, "apps/saas/.env.local");
const WORKFLOWS = join(ROOT, "apps/workflows/.env.local");
const DB = join(ROOT, "packages/db/.env.local");
const APP_URL = "http://localhost:3010";
const DEV_SIGN_IN_URL = `${APP_URL}/api/dev/sign-in`;

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

function isLocalUrl(url: string): boolean {
  return url.includes("127.0.0.1") || url.includes("localhost");
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
// local Supabase provisioning
// ---------------------------------------------------------------------------

function sbCli(
  args: string[],
  opts: { capture?: boolean } = {},
): { ok: boolean; stdout: string } {
  const res = spawnSync(
    "bunx",
    ["supabase", "--workdir", "packages/db", ...args],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        AUTH_RESEND_KEY: process.env.AUTH_RESEND_KEY || "local-dev-unused",
      },
      stdio: opts.capture ? ["ignore", "pipe", "pipe"] : "inherit",
      encoding: "utf8",
    },
  );
  return { ok: res.status === 0, stdout: res.stdout ?? "" };
}

function unlinkHostedProjectForLocalSetup(): void {
  const linkedFiles = [
    join(ROOT, "packages/db/supabase/.temp/linked-project.json"),
    join(ROOT, "packages/db/supabase/.temp/project-ref"),
  ];
  if (!linkedFiles.some((file) => existsSync(file))) return;

  console.log("Ignoring hosted Supabase link for local setup...");
  spawnSync(
    "bunx",
    ["supabase", "--workdir", "packages/db", "unlink", "--yes"],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        AUTH_RESEND_KEY: process.env.AUTH_RESEND_KEY || "local-dev-unused",
      },
      stdio: "ignore",
      encoding: "utf8",
    },
  );
}

function pickKey(obj: Record<string, unknown>, ...names: string[]): string {
  for (const n of names) {
    const v = obj[n];
    if (typeof v === "string" && v) return v;
  }
  return "";
}

async function provisionLocal(): Promise<void> {
  // Refuse to silently flip an env that points at a hosted project.
  const currentUrl = readEnv(SAAS).get("NEXT_PUBLIC_SUPABASE_URL") ?? "";
  if (currentUrl && !isLocalUrl(currentUrl)) {
    console.log(
      `\nYour env points at a hosted Supabase project (${currentUrl}).
Keeping it. To switch to the local stack, clear the Supabase
values in apps/*/.env.local and re-run; to stay hosted, use
\`bun run setup --hosted\`.`,
    );
    return;
  }

  // Docker is the only hard prerequisite for the local stack.
  const docker = spawnSync("docker", ["info"], { stdio: "ignore" });
  if (docker.status !== 0) {
    console.log(
      "\nDocker is not running. The default setup runs Supabase locally" +
        "\nin Docker — start Docker Desktop / OrbStack / Colima and re-run," +
        "\nor use `bun run setup --hosted` with a supabase.com project.",
    );
    process.exit(1);
  }

  // Start (or reuse) the stack, then read its connection details.
  console.log("\nStarting local Supabase (first run downloads images)...");
  unlinkHostedProjectForLocalSetup();
  let status = sbCli(["status", "-o", "json"], { capture: true });
  if (!status.ok) {
    const started = sbCli(["start"]);
    if (!started.ok) {
      console.log("supabase start failed — see output above.");
      process.exit(1);
    }
    status = sbCli(["status", "-o", "json"], { capture: true });
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(status.stdout.slice(status.stdout.indexOf("{")));
  } catch {
    console.log(
      `Could not parse \`supabase status -o json\`:\n${status.stdout}`,
    );
    process.exit(1);
  }
  const apiUrl = pickKey(parsed, "API_URL", "apiUrl");
  const anonKey = pickKey(parsed, "ANON_KEY", "anonKey");
  const serviceKey = pickKey(parsed, "SERVICE_ROLE_KEY", "serviceRoleKey");
  const jwtSecret = pickKey(parsed, "JWT_SECRET", "jwtSecret");
  const dbUrl = pickKey(parsed, "DB_URL", "dbUrl");
  if (!apiUrl || !anonKey || !serviceKey || !jwtSecret || !dbUrl) {
    console.log(
      `\`supabase status\` is missing expected fields. Got keys: ${Object.keys(parsed).join(", ")}`,
    );
    process.exit(1);
  }

  // The stack's values are authoritative for a local env — overwrite.
  for (const f of [SAAS, WORKFLOWS]) {
    upsertEnv(f, "NEXT_PUBLIC_SUPABASE_URL", apiUrl);
    upsertEnv(f, "SUPABASE_SECRET_KEY", serviceKey);
  }
  upsertEnv(SAAS, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", anonKey);
  upsertEnv(SAAS, "SUPABASE_JWT_SECRET", jwtSecret);
  upsertEnv(SAAS, "BETTER_AUTH_DATABASE_URL", dbUrl);
  upsertEnv(SAAS, "DEV_AUTH_BYPASS", "1");
  console.log(`local stack up at ${apiUrl}; env written`);

  // Apply any pending migrations (no-op when current).
  console.log("Applying migrations...");
  if (!sbCli(["migration", "up", "--local"]).ok) {
    console.log("migration up failed — see output above.");
    process.exit(1);
  }
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
function info(msg: string): void {
  console.log(`  info  ${msg}`);
}

// ---------------------------------------------------------------------------
// launch helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForApp(url: string, timeoutMs = 60_000): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.status < 500) return true;
    } catch {
      // The dev server is still booting.
    }
    await sleep(1000);
  }
  return false;
}

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args =
    process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const res = spawnSync(command, args, { stdio: "ignore" });
  if (res.status !== 0) {
    console.log(`Could not open a browser automatically. Open ${url}`);
  }
}

async function launchDevServer(): Promise<void> {
  console.log("\nStarting dev server...");
  const dev = spawn("bun", ["dev"], {
    cwd: ROOT,
    stdio: "inherit",
  });

  const stop = (): void => {
    dev.kill("SIGINT");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const ready = await waitForApp(APP_URL);
  if (ready) {
    console.log(`\nOpening ${DEV_SIGN_IN_URL}`);
    openBrowser(DEV_SIGN_IN_URL);
    console.log("\nDev server is running. Press Ctrl-C to stop.");
  } else {
    console.log(
      `\nDev server is still starting. Open ${DEV_SIGN_IN_URL} when it is ready.`,
    );
  }

  const exitCode = await new Promise<number | null>((resolve) => {
    dev.once("exit", (code) => resolve(code));
  });
  process.exit(exitCode ?? 0);
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
  if (!existsSync(DB))
    warn(`${DB} missing (only needed for Resend SMTP config)`);
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
    warn(
      "API_KEY_ENCRYPTION_SECRET is not 64 hex chars (openssl rand -hex 32)",
    );

  if (saas.get("BETTER_AUTH_SECRET")) pass("BETTER_AUTH_SECRET set");
  else fail("BETTER_AUTH_SECRET is empty");

  // Supabase coherence.
  const url = saas.get("NEXT_PUBLIC_SUPABASE_URL") ?? "";
  if (!url) fail("NEXT_PUBLIC_SUPABASE_URL is empty in saas");
  else if (url !== wf.get("NEXT_PUBLIC_SUPABASE_URL"))
    fail("NEXT_PUBLIC_SUPABASE_URL differs between saas and workflows");
  else
    pass(
      `NEXT_PUBLIC_SUPABASE_URL matches across apps (${isLocalUrl(url) ? "local" : "hosted"})`,
    );
  for (const key of [
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_JWT_SECRET",
    "BETTER_AUTH_DATABASE_URL",
  ]) {
    if (saas.get(key)) pass(`${key} set`);
    else fail(`${key} is empty in saas`);
  }
  if (wf.get("SUPABASE_SECRET_KEY"))
    pass("SUPABASE_SECRET_KEY set in workflows");
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
      else
        fail(
          `Supabase responded ${res.status} — check URL and publishable key`,
        );
    } catch (err) {
      const hint = isLocalUrl(url)
        ? " (is the local stack running? `bunx supabase --workdir packages/db start`)"
        : "";
      fail(
        `Supabase unreachable: ${err instanceof Error ? err.message : err}${hint}`,
      );
    }
  }

  // LLM env fallback is optional; normal local setup adds BYOK keys in-app.
  const provider = saas.get("MODEL_PROVIDER") ?? "";
  const keyName =
    provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const saasKey = provider ? saas.get(keyName) : "";
  const wfKey = provider ? wf.get(keyName) : "";
  if (!provider) info("LLM keys are configured in the app during onboarding");
  else if (!saasKey && !wfKey)
    info("LLM keys are configured in the app during onboarding");
  else if (!saasKey || !wfKey)
    info("LLM keys are configured in the app during onboarding");
  else pass(`dev LLM fallback configured (${provider})`);

  if (saas.get("DEV_AUTH_BYPASS") === "1")
    pass("DEV_AUTH_BYPASS=1 — sign in locally via /api/dev/sign-in");
  else warn("DEV_AUTH_BYPASS is off — local sign-in requires a Resend key");
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const checkOnly = process.argv.includes("--check");
const hosted = process.argv.includes("--hosted");
const launch = process.argv.includes("--launch");

if (!checkOnly) {
  console.log(`Wargame setup (${hosted ? "hosted" : "local"} Supabase)\n`);

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

  if (hosted) {
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
  } else {
    await provisionLocal();
  }

  console.log("\nLLM keys:");
  console.log("  configure OpenAI or Anthropic in the app during onboarding.");
}

await doctor();
rl.close();

if (failures === 0) {
  const finalUrl = readEnv(SAAS).get("NEXT_PUBLIC_SUPABASE_URL") ?? "";
  if (launch) {
    await launchDevServer();
  }
  console.log("\nNext steps:");
  if (isLocalUrl(finalUrl)) {
    console.log(
      "  1. bun dev                # then open http://localhost:3010",
    );
    console.log(
      "     Sign in locally via http://localhost:3010/api/dev/sign-in",
    );
    console.log("  Supabase Studio: http://127.0.0.1:54323");
    console.log(
      "  Stop the stack with: bunx supabase --workdir packages/db stop",
    );
    console.log("  Or run setup and launch together: bun run setup --launch");
  } else {
    console.log("  1. bun db:link            # link to your Supabase project");
    console.log(
      "  2. Run packages/db/supabase/migrations/*_init.sql in the Supabase SQL editor",
    );
    console.log(
      "  3. bun dev                # then open http://localhost:3010",
    );
    console.log(
      "     Sign in locally via http://localhost:3010/api/dev/sign-in",
    );
    console.log("  Or run setup and launch together: bun run setup --launch");
  }
  if (warnings) console.log(`\n${warnings} warning(s) above.`);
} else {
  console.log(`\n${failures} check(s) failed. Fix the FAIL lines and re-run.`);
  process.exit(1);
}
