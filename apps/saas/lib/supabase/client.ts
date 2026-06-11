"use client";
// Browser-side Supabase client. The JWT bridge gives Realtime + any
// browser-side query an authenticated identity (the signed-in
// Better-Auth user). The token is fetched once per page load via
// /api/auth/supabase-token; the supabase-js `accessToken` callback
// re-runs it as needed.
//
// Storage uploads still use the publishable-key shortcut and the
// signed URL token from generateFileUpload — they don't need
// Realtime auth.
import type { Database } from "@/types/database.types";
import {
  type SupabaseClient,
  createClient as createSupabaseClient,
} from "@supabase/supabase-js";

let cached: SupabaseClient<Database> | null = null;

async function fetchBridgeToken(): Promise<string | null> {
  const r = await fetch("/api/auth/supabase-token");
  if (!r.ok) return null;
  const { token } = (await r.json()) as { token: string };
  return token;
}

export function createClient(): SupabaseClient<Database> {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error(
      "Supabase env vars missing: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required for the browser client.",
    );
  }
  cached = createSupabaseClient<Database>(
    url,
    publishableKey,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      accessToken: async () => (await fetchBridgeToken()) ?? "",
    },
  );
  // Realtime needs setAuth explicitly — the accessToken callback
  // covers PostgREST/Storage but not the WS channel. Refresh once a
  // minute; tokens are 1h so this is well within margin.
  void primeRealtimeAuth(cached);
  return cached;
}

async function primeRealtimeAuth(
  client: SupabaseClient<Database>,
): Promise<void> {
  const apply = async () => {
    const token = await fetchBridgeToken();
    if (token) client.realtime.setAuth(token);
  };
  await apply();
  setInterval(apply, 10 * 60 * 1000);
}
