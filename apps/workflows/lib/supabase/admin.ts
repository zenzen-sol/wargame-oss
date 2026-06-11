// Workflow-runtime admin client. Workflow steps are trusted server
// code — they bypass RLS via the secret key. The trigger-token
// handshake at the start-extraction route is the boundary.
import type { Database } from "@/types/database.types";
import { createClient } from "@supabase/supabase-js";

let cached: ReturnType<typeof createClient<Database>> | undefined;

export function createAdminClient() {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set on the workflows runtime.",
    );
  }
  cached = createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}
