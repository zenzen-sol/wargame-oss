// Server-side helpers for fetching the current Better-Auth user and
// for ownership-gated project lookups. RLS does the actual data-
// scoping at the Postgres level (the JWT bridge in
// @/lib/supabase-jwt.ts populates `auth.uid()`); these helpers exist
// to give callers a clean redirect / Response when there's no row.
import "server-only";
import { auth } from "@/lib/auth";
import { getDisclaimerAcknowledgedAt } from "@/lib/better-auth-db";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database.types";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
};

// Per Vercel `server-cache-react`: wrap per-request lookups in
// React.cache so multiple callers within the same render tree share
// one Better-Auth session probe instead of doing a DB hit per call.
// Use this from anywhere that needs the raw BA session (the JWT
// bridge, getSessionUser, etc.).
export const getCachedSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getCachedSession();
  if (!session?.user) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");
  return user;
}

/**
 * requireUser + disclaimer ack check. The (auth) layout already
 * redirects unack'd users to /welcome/disclaimer, but server actions
 * are POST endpoints reachable independent of any layout — a logged-in
 * user who never acked could call createProject / saveApiKey / chat
 * directly. Defense-in-depth: every action that creates a new project,
 * saves credentials, or kicks off LLM work calls this instead of
 * requireUser.
 *
 * Reads disclaimer_acknowledged_at through the same direct Postgres
 * boundary Better-Auth uses. The `user` table is intentionally not
 * part of the Supabase/PostgREST app data surface.
 */
export async function requireUserWithDisclaimer(): Promise<SessionUser> {
  const user = await requireUser();
  let acknowledgedAt: string | null;
  try {
    acknowledgedAt = await getDisclaimerAcknowledgedAt(user.id);
  } catch (error) {
    console.error("[auth-session] disclaimer lookup failed", error);
    throw new Response("Internal error", { status: 500 });
  }
  if (!acknowledgedAt) {
    throw new Response("Disclaimer not acknowledged.", { status: 403 });
  }
  return user;
}

export async function requireProjectById(
  id: string,
): Promise<{ user: SessionUser; project: Tables<"projects"> }> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: project, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Response(error.message, { status: 500 });
  if (!project) throw new Response("Not found", { status: 404 });
  return { user, project };
}

export async function requireProjectBySlug(
  slug: string,
): Promise<{ user: SessionUser; project: Tables<"projects"> }> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: project, error } = await supabase
    .from("projects")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Response(error.message, { status: 500 });
  if (!project) throw new Response("Not found", { status: 404 });
  return { user, project };
}
