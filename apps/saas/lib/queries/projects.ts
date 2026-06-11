// Server-side reads. RLS scopes everything to the signed-in user
// automatically; we don't pass user ids around.
import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database.types";

export type Project = Tables<"projects">;
export type FileRow = Tables<"files">;
export type ProjectParty = Tables<"project_parties">;
export type InterviewAnswer = Tables<"interview_answers">;
export type Issue = Tables<"issues">;
export type MessageRow = Tables<"messages">;

export type ProjectSummary = Project & {
  project_parties: Pick<ProjectParty, "name" | "role" | "is_user_side">[];
  files: Pick<FileRow, "name">[];
};

export async function listProjectsForUser(): Promise<ProjectSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*, project_parties(name, role, is_user_side), files(name)")
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as unknown as ProjectSummary[];
}

export async function getProjectBySlug(
  slug: string,
): Promise<Project | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getProjectById(id: string): Promise<Project | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listFilesForProject(
  projectId: string,
): Promise<FileRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("files")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function listPartiesForProject(
  projectId: string,
): Promise<ProjectParty[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_parties")
    .select("*")
    .eq("project_id", projectId)
    .order("side", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function listInterviewAnswers(
  projectId: string,
): Promise<InterviewAnswer[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("interview_answers")
    .select("*")
    .eq("project_id", projectId);
  if (error) throw error;
  return data ?? [];
}

export async function listIssuesForProject(
  projectId: string,
): Promise<Issue[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("issues")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function listMessagesForProject(
  projectId: string,
): Promise<MessageRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw error;
  return data ?? [];
}

