#!/usr/bin/env bun
// Dev-only: store the env-file LLM key as a BYOK row for a local
// user, exactly as the onboarding Save button would (same crypto,
// same table), minus the paid validation probe. Lets agent-driven
// local verification get past the onboarding key gate without
// pasting credentials anywhere.
//
//   bun --env-file=apps/saas/.env.local scripts/dev-seed-llm-key.ts <email>
//
// Refuses to run against a non-local Supabase URL.

import { createClient } from "@supabase/supabase-js";
import { encryptApiKey } from "@wargame-esq/agents";

const email = process.argv[2];
if (!email) {
  console.error("usage: dev-seed-llm-key.ts <email>");
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!url.includes("127.0.0.1") && !url.includes("localhost")) {
  console.error(`refusing: ${url || "(no url)"} is not a local stack`);
  process.exit(1);
}
const provider = process.env.MODEL_PROVIDER === "anthropic" ? "anthropic" : "openai";
const plaintext =
  provider === "anthropic"
    ? process.env.ANTHROPIC_API_KEY
    : process.env.OPENAI_API_KEY;
if (!plaintext || !process.env.API_KEY_ENCRYPTION_SECRET) {
  console.error("OPENAI_API_KEY/ANTHROPIC_API_KEY or API_KEY_ENCRYPTION_SECRET missing in env");
  process.exit(1);
}

const admin = createClient(url, process.env.SUPABASE_SECRET_KEY ?? "");
const { data: user, error: userErr } = await admin
  .from("user")
  .select("id")
  .eq("email", email)
  .single();
if (userErr || !user) {
  console.error(`no user with email ${email}: ${userErr?.message}`);
  process.exit(1);
}

const enc = encryptApiKey(plaintext);
const { error } = await admin.from("user_api_keys").upsert(
  {
    user_id: user.id,
    provider,
    encrypted_key: enc.encryptedKey,
    iv: enc.iv,
    auth_tag: enc.authTag,
    is_default: true,
  },
  { onConflict: "user_id,provider" },
);
if (error) {
  console.error(`insert failed: ${error.message}`);
  process.exit(1);
}
console.log(`seeded ${provider} key for ${email}`);
