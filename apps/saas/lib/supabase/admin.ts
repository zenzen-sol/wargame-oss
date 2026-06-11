// Server-only admin client. Uses the secret key (sb_secret_…), which
// bypasses RLS entirely. Use ONLY for trusted backend operations —
// the chat route's persist step, the workflow's extraction writes,
// Storage admin (signed URLs).
//
// For anything that should be scoped to the signed-in user, use
// createClient() from ./server.ts — it goes through RLS.
import "server-only";
import type { Database } from "@/types/database.types";
import { createClient } from "@supabase/supabase-js";

let cached: ReturnType<typeof createClient<Database>> | undefined;

export function createAdminClient() {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set on the server.",
    );
  }
  cached = createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}
