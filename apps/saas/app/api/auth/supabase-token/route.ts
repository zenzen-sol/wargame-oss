// Mints a Supabase-bridge JWT for the signed-in Better-Auth user so
// the BROWSER can authenticate Supabase Realtime + (later) any direct
// browser-side queries that need RLS context.
//
// Why: Realtime validates incoming WS connections against PostgREST's
// JWT secret (the same SUPABASE_JWT_SECRET we sign with server-side).
// Without setAuth on the browser client, subscriptions return rows
// only when policies allow `anon` — which they don't.
import { getCachedSession } from "@/lib/auth-session";
import { mintSupabaseJwt } from "@/lib/supabase-jwt";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const session = await getCachedSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const token = await mintSupabaseJwt(session.user.id);
  return NextResponse.json({ token });
}
