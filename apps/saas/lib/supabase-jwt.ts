// Bridge between Better-Auth sessions and Supabase RLS.
//
// Supabase's PostgREST validates a JWT on every request and reads
// `request.jwt.claims.sub` into `auth.uid()`. To use RLS while
// authenticating via Better-Auth, we mint a JWT signed with the
// project's `SUPABASE_JWT_SECRET` (the Legacy JWT Secret in the
// dashboard) carrying:
//
//   sub:  <better-auth-user-id>      ← becomes auth.uid()
//   role: "authenticated"            ← becomes the Postgres role
//   aud:  "authenticated"            ← required by PostgREST
//
// The JWT is short-lived (1 hour) and re-minted per Supabase client
// request via supabase-js's `accessToken` callback. Better-Auth's
// session cookie is the source of truth; this JWT is a per-request
// projection of it.
import "server-only";
import { SignJWT } from "jose";

let cachedKey: Uint8Array | null = null;

function getKey(): Uint8Array {
  if (cachedKey) return cachedKey;
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    throw new Error(
      "SUPABASE_JWT_SECRET is not set. Get it from Supabase → " +
        "Project Settings → JWT Keys → Legacy JWT Secret.",
    );
  }
  cachedKey = new TextEncoder().encode(secret);
  return cachedKey;
}

export async function mintSupabaseJwt(userId: string): Promise<string> {
  return await new SignJWT({
    sub: userId,
    role: "authenticated",
    aud: "authenticated",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(getKey());
}
