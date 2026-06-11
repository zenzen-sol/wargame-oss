// Server-side Supabase client for server components, server actions,
// and route handlers. Auth comes from Better-Auth (via cookies); we
// mint a Supabase-compatible JWT per request and pass it via the
// supabase-js v2 `accessToken` callback. PostgREST validates and
// populates `request.jwt.claims`, so RLS policies work.
import "server-only";
import { getCachedSession } from "@/lib/auth-session";
import { mintSupabaseJwt } from "@/lib/supabase-jwt";
import type { Database } from "@/types/database.types";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set.",
    );
  }
  return createSupabaseClient<Database>(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    accessToken: async () => {
      // Shares the React.cache'd Better-Auth session probe with the
      // rest of the request — no duplicate DB hit per supabase query.
      const session = await getCachedSession();
      if (!session?.user) return null;
      return await mintSupabaseJwt(session.user.id);
    },
  });
}
